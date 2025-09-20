/**
 * Content-Addressed Object Storage Layer
 * Pure content-addressed storage without foreign keys
 */

const zlib = require('zlib');
const { hashData } = require('./utils');
const { createDelta, applyDelta, isDeltaWorthwhile, serializeDelta, deserializeDelta } = require('./delta');

// SQLite database instance - will be injected
let Database;

// Try to load SQLite (Node.js default) - only in Node.js environment
if (typeof window === 'undefined' && typeof global !== 'undefined') {
  try {
    Database = require('better-sqlite3');
  } catch (error) {
    // SQLite will be provided via dependency injection
  }
}

class ContentAddressedStore {
  constructor(dbPath = 'webdvcs.sqlite', DatabaseConstructor = null) {
    this.dbPath = dbPath;

    // Use injected Database constructor or default
    const DbConstructor = DatabaseConstructor || Database;

    if (!DbConstructor) {
      throw new Error("SQLite database not available. Provide DatabaseConstructor or install better-sqlite3 for Node.js.");
    }

    // Initialize database with injected or default constructor
    this.db = new DbConstructor(dbPath);
    this.initSchema();
    this.prepareStatements();
  }

  initSchema() {
    // NO foreign key constraints - pure content addressing
    this.db.exec(`
      -- Pure content-addressed object storage
      CREATE TABLE IF NOT EXISTS objects (
        hash TEXT PRIMARY KEY,           -- SHA-256 content hash
        type TEXT NOT NULL,              -- 'blob', 'tree', 'commit'
        size INTEGER NOT NULL,           -- Uncompressed size
        data BLOB NOT NULL,              -- Compressed object data
        compression TEXT DEFAULT 'zlib', -- Compression algorithm
        created_at INTEGER NOT NULL,
        CHECK(length(hash) = 64)         -- SHA-256 = 64 chars
      );

      -- Reference pointers (branches, tags)
      CREATE TABLE IF NOT EXISTS refs (
        name TEXT PRIMARY KEY,           -- 'refs/heads/main', 'refs/tags/v1.0'
        hash TEXT NOT NULL,              -- Points to commit object hash
        type TEXT DEFAULT 'branch',      -- 'branch', 'tag'
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        CHECK(length(hash) = 64)
      );

      -- Repository metadata
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT,
        CHECK(length(key) > 0)
      );

      -- Delta compression storage
      CREATE TABLE IF NOT EXISTS deltas (
        hash TEXT PRIMARY KEY,           -- Hash of the new (delta) object
        base_hash TEXT NOT NULL,         -- Hash of the base object
        delta_data BLOB NOT NULL,        -- Serialized delta operations
        original_size INTEGER NOT NULL, -- Size of original data
        delta_size INTEGER NOT NULL,    -- Size of delta
        compression_ratio REAL,         -- Compression achieved
        created_at INTEGER NOT NULL,
        CHECK(length(hash) = 64),       -- SHA-256 = 64 chars
        CHECK(length(base_hash) = 64)   -- SHA-256 = 64 chars
      );

      -- Performance indexes
      CREATE INDEX IF NOT EXISTS idx_objects_type ON objects(type);
      CREATE INDEX IF NOT EXISTS idx_objects_created ON objects(created_at);
      CREATE INDEX IF NOT EXISTS idx_refs_updated ON refs(updated_at);
      CREATE INDEX IF NOT EXISTS idx_deltas_base ON deltas(base_hash);
      CREATE INDEX IF NOT EXISTS idx_deltas_created ON deltas(created_at);
    `);
  }

  prepareStatements() {
    // Object operations
    this.insertObject = this.db.prepare('INSERT OR IGNORE INTO objects (hash, type, size, data, compression, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    this.selectObject = this.db.prepare('SELECT * FROM objects WHERE hash = ?');
    this.deleteObject = this.db.prepare('DELETE FROM objects WHERE hash = ?');
    this.listObjectsByType = this.db.prepare('SELECT hash, type, size, created_at FROM objects WHERE type = ? ORDER BY created_at DESC');
    this.countObjects = this.db.prepare('SELECT COUNT(*) as count FROM objects');

    // Reference operations
    this.insertRef = this.db.prepare('INSERT OR REPLACE INTO refs (name, hash, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)');
    this.selectRef = this.db.prepare('SELECT * FROM refs WHERE name = ?');
    this.deleteRef = this.db.prepare('DELETE FROM refs WHERE name = ?');
    this.selectAllRefs = this.db.prepare('SELECT * FROM refs ORDER BY name');

    // Metadata operations
    this.insertMeta = this.db.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)');
    this.selectMeta = this.db.prepare('SELECT value FROM metadata WHERE key = ?');
    this.deleteMeta = this.db.prepare('DELETE FROM metadata WHERE key = ?');

    // Delta operations
    this.insertDelta = this.db.prepare(`
      INSERT INTO deltas (hash, base_hash, delta_data, original_size, delta_size, compression_ratio, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    this.selectDelta = this.db.prepare('SELECT * FROM deltas WHERE hash = ?');
    this.deleteDelta = this.db.prepare('DELETE FROM deltas WHERE hash = ?');
    this.selectObjectOrDelta = this.db.prepare(`
      SELECT o.hash, o.type, o.size, o.data, o.compression,
             d.base_hash, d.delta_data, d.original_size, d.delta_size
      FROM objects o
      LEFT JOIN deltas d ON o.hash = d.hash
      WHERE o.hash = ?
    `);
  }

  // Core object storage operations

  /**
   * Store an object with automatic content addressing
   * @param {Uint8Array} content - Raw object content
   * @param {string} type - Object type ('blob', 'tree', 'commit')
   * @param {string} compression - Compression algorithm ('zlib', 'none')
   * @returns {Object} - {hash, isNew}
   */
  storeObject(content, type, compression = 'zlib') {
    // Ensure content is Uint8Array
    const contentArray = content instanceof Uint8Array ? content : new Uint8Array(content);

    // Hash the uncompressed content
    const hash = hashData(contentArray);

    // Check if object already exists
    const existing = this.selectObject.get(hash);
    if (existing) {
      return { hash, isNew: false };
    }

    // Compress the content
    let compressedData;
    if (compression === 'zlib') {
      // browserify-zlib needs a Buffer, not Uint8Array
      const buffer = Buffer.from(contentArray);
      compressedData = zlib.deflateSync(buffer);
    } else {
      compressedData = contentArray;
      compression = 'none';
    }

    // Store the object
    const now = Date.now();
    this.insertObject.run(hash, type, contentArray.length, compressedData, compression, now);

    return { hash, isNew: true };
  }

  /**
   * Store blob with delta compression if beneficial
   * @param {Uint8Array} data - Data to store
   * @param {string} baseHash - Hash of base object for delta compression
   * @returns {Object} - Storage result with hash and metadata
   */
  storeBlobWithDelta(data, baseHash = null) {
    // If no base hash provided, store as regular blob
    if (!baseHash) {
      const result = this.storeObject(data, 'blob');
      return {
        hash: result.hash,
        size: data.length,
        usedDelta: false,
        deltaSize: data.length,
        compressionRatio: 0,
        reason: 'no_base_hash'
      };
    }

    // Check if base object exists
    if (!this.hasObject(baseHash)) {
      const result = this.storeObject(data, 'blob');
      return {
        hash: result.hash,
        size: data.length,
        usedDelta: false,
        deltaSize: data.length,
        compressionRatio: 0,
        reason: 'base_not_found'
      };
    }

    try {
      // Get base data for delta compression
      const baseObject = this.getObject(baseHash);
      if (!baseObject) {
        const result = this.storeObject(data, 'blob');
        return {
          hash: result.hash,
          size: data.length,
          usedDelta: false,
          deltaSize: data.length,
          compressionRatio: 0,
          reason: 'base_retrieval_failed'
        };
      }

      const baseData = baseObject.data;

      // Create delta using advanced algorithm
      const delta = createDelta(baseData, data);

      // Check if delta compression is worthwhile
      if (isDeltaWorthwhile(data.length, delta.deltaSize)) {
        // Store delta and return delta reference
        return this.storeDelta(data, delta, baseHash);
      } else {
        // Delta not beneficial, store full file
        const result = this.storeObject(data, 'blob');
        return {
          hash: result.hash,
          size: data.length,
          usedDelta: false,
          deltaSize: data.length,
          compressionRatio: 0,
          reason: 'delta_not_beneficial'
        };
      }
    } catch (error) {
      // Delta failed, fallback to full storage
      const result = this.storeObject(data, 'blob');
      return {
        hash: result.hash,
        size: data.length,
        usedDelta: false,
        deltaSize: data.length,
        compressionRatio: 0,
        reason: `delta_error: ${error.message}`
      };
    }
  }

  /**
   * Store delta data with metadata
   * @param {Uint8Array} originalData - The full original data
   * @param {Object} delta - Delta object from createDelta()
   * @param {string} baseHash - Hash of base object for delta
   * @returns {Object} Storage result with hash and stats
   */
  storeDelta(originalData, delta, baseHash) {
    const originalHash = hashData(originalData);
    const serializedDelta = serializeDelta(delta);
    const compressionRatio = ((originalData.length - delta.deltaSize) / originalData.length) * 100;

    return this.transaction(() => {
      // Store minimal placeholder in objects table (type: 'delta')
      this.insertObject.run(originalHash, 'delta', originalData.length, new Uint8Array(0), 'none', Date.now());

      // Store delta metadata and data
      this.insertDelta.run(
        originalHash,
        baseHash,
        serializedDelta,
        originalData.length,
        delta.deltaSize,
        compressionRatio,
        Math.floor(Date.now() / 1000)
      );

      return {
        hash: originalHash,
        size: originalData.length,
        usedDelta: true,
        deltaSize: delta.deltaSize,
        compressionRatio: compressionRatio,
        baseHash: baseHash,
        reason: 'delta_compressed'
      };
    });
  }

  /**
   * Get object data, reconstructing from delta if necessary
   * @param {string} hash - Object hash
   * @returns {Uint8Array|null} Object data or null if not found
   */
  getObjectWithDelta(hash) {
    // First check if it's a delta object
    const deltaInfo = this.selectDelta.get(hash);
    if (deltaInfo) {
      // Reconstruct from delta
      const baseData = this.getObjectWithDelta(deltaInfo.base_hash); // Recursive for delta chains
      if (!baseData) {
        throw new Error(`Delta base object ${deltaInfo.base_hash} not found`);
      }

      const delta = deserializeDelta(deltaInfo.delta_data, deltaInfo.base_hash, hash, deltaInfo.original_size);
      return applyDelta(baseData, delta);
    }

    // Regular object - get data and return just the data array
    const obj = this.getObjectData(hash);
    return obj ? obj.data : null;
  }

  /**
   * Check if object exists (regular or delta)
   * @param {string} hash - Object hash
   * @returns {boolean} True if object exists
   */
  hasObjectWithDelta(hash) {
    // Check regular objects first
    if (this.hasObjectData(hash)) {
      return true;
    }

    // Check delta objects
    const deltaInfo = this.selectDelta.get(hash);
    return !!deltaInfo;
  }

  /**
   * Get delta chain information for debugging
   * @param {string} hash - Object hash
   * @returns {Object} Chain information
   */
  getDeltaChain(hash) {
    const chain = [];
    let currentHash = hash;

    while (currentHash) {
      const deltaInfo = this.selectDelta.get(currentHash);
      if (deltaInfo) {
        chain.push({
          hash: currentHash,
          baseHash: deltaInfo.base_hash,
          originalSize: deltaInfo.original_size,
          deltaSize: deltaInfo.delta_size,
          compressionRatio: deltaInfo.compression_ratio
        });
        currentHash = deltaInfo.base_hash;
      } else {
        // End of chain - this should be a regular object
        if (this.hasObjectData(currentHash)) {
          const obj = this.getObjectData(currentHash);
          chain.push({
            hash: currentHash,
            baseHash: null,
            originalSize: obj.size,
            deltaSize: obj.size,
            compressionRatio: 0,
            isBase: true
          });
        }
        break;
      }
    }

    return {
      chain,
      totalChainLength: chain.length,
      totalCompressionRatio: chain.length > 1 ?
        ((chain[0].originalSize - chain.reduce((sum, item) => sum + item.deltaSize, 0)) / chain[0].originalSize) * 100 : 0
    };
  }

  /**
   * Validate delta chain to prevent infinite loops and detect circular references
   * @param {string} hash - Object hash
   * @param {number} maxDepth - Maximum allowed chain depth
   * @returns {number} Actual chain depth
   */
  validateDeltaChain(hash, maxDepth = 10) {
    const visited = new Set();
    let currentHash = hash;
    let depth = 0;

    while (currentHash && depth < maxDepth) {
      if (visited.has(currentHash)) {
        throw new Error(`Circular delta chain detected: ${currentHash}`);
      }
      visited.add(currentHash);

      const deltaInfo = this.selectDelta.get(currentHash);
      if (!deltaInfo) break;

      currentHash = deltaInfo.base_hash;
      depth++;
    }

    if (depth >= maxDepth) {
      throw new Error(`Delta chain too deep (>${maxDepth}): possible infinite loop`);
    }

    return depth;
  }

  /**
   * Retrieve an object by hash (original method renamed for internal use)
   * @param {string} hash - Object hash
   * @returns {Object|null} - {hash, type, size, data, compression, created_at}
   */
  getObjectData(hash) {
    const row = this.selectObject.get(hash);
    if (!row) return null;

    // Decompress the content
    let content;
    if (row.compression === 'zlib') {
      // browserify-zlib needs a Buffer, not Uint8Array
      const buffer = Buffer.from(row.data);
      content = zlib.inflateSync(buffer);
    } else {
      content = row.data;
    }

    return {
      hash: row.hash,
      type: row.type,
      size: row.size,
      data: new Uint8Array(content),
      compression: row.compression,
      created_at: row.created_at
    };
  }

  /**
   * Check if regular object exists (original method renamed for internal use)
   * @param {string} hash - Object hash
   * @returns {boolean}
   */
  hasObjectData(hash) {
    const row = this.selectObject.get(hash);
    return !!row;
  }

  /**
   * Retrieve an object by hash (now delta-aware)
   * @param {string} hash - Object hash
   * @returns {Object|null} - {hash, type, size, data, compression, created_at}
   */
  getObject(hash) {
    // For delta objects, we need to reconstruct and return proper object format
    const deltaInfo = this.selectDelta.get(hash);
    if (deltaInfo) {
      const data = this.getObjectWithDelta(hash);
      if (!data) return null;

      return {
        hash: hash,
        type: 'blob', // Delta objects are stored as blobs
        size: deltaInfo.original_size,
        data: data,
        compression: 'delta',
        created_at: deltaInfo.created_at * 1000 // Convert back to milliseconds
      };
    }

    // Regular object
    return this.getObjectData(hash);
  }

  /**
   * Check if object exists (now delta-aware)
   * @param {string} hash - Object hash
   * @returns {boolean}
   */
  hasObject(hash) {
    return this.hasObjectWithDelta(hash);
  }

  /**
   * Delete an object
   * @param {string} hash - Object hash
   * @returns {boolean} - True if deleted
   */
  removeObject(hash) {
    const result = this.deleteObject.run(hash);
    return result.changes > 0;
  }

  // Reference operations

  /**
   * Create or update a reference
   * @param {string} name - Reference name (e.g., 'refs/heads/main')
   * @param {string} hash - Target object hash
   * @param {string} type - Reference type ('branch', 'tag')
   */
  setRef(name, hash, type = 'branch') {
    const now = Date.now();
    const existing = this.selectRef.get(name);
    const createdAt = existing ? existing.created_at : now;

    this.insertRef.run(name, hash, type, createdAt, now);
  }

  /**
   * Get a reference
   * @param {string} name - Reference name
   * @returns {Object|null} - {name, hash, type, created_at, updated_at}
   */
  getRef(name) {
    const row = this.selectRef.get(name);
    return row || null;
  }

  /**
   * Delete a reference
   * @param {string} name - Reference name
   * @returns {boolean} - True if deleted
   */
  removeRef(name) {
    const result = this.deleteRef.run(name);
    return result.changes > 0;
  }

  /**
   * List all references
   * @returns {Array} - Array of reference objects
   */
  listRefs() {
    return this.selectAllRefs.all();
  }

  // Metadata operations

  /**
   * Set metadata
   * @param {string} key - Metadata key
   * @param {string} value - Metadata value
   */
  setMeta(key, value) {
    this.insertMeta.run(key, value);
  }

  /**
   * Get metadata
   * @param {string} key - Metadata key
   * @returns {string|null} - Metadata value
   */
  getMeta(key) {
    const row = this.selectMeta.get(key);
    return row ? row.value : null;
  }

  /**
   * Delete metadata
   * @param {string} key - Metadata key
   * @returns {boolean} - True if deleted
   */
  removeMeta(key) {
    const result = this.deleteMeta.run(key);
    return result.changes > 0;
  }

  // Utility operations

  /**
   * Get database statistics
   * @returns {Object} - Database statistics
   */
  getStats() {
    const objectCount = this.countObjects.get().count;
    const refCount = this.listRefs().length;

    return {
      dbPath: this.dbPath,
      objects: objectCount,
      refs: refCount,
      dbSize: this.db.prepare("SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()").get().size
    };
  }

  /**
   * Execute a function in a transaction
   * @param {Function} fn - Function to execute
   * @returns {*} - Function return value
   */
  transaction(fn) {
    return this.db.transaction(fn)();
  }

  /**
   * Close the database
   */
  close() {
    this.db.close();
  }
}

module.exports = {
  ContentAddressedStore,
  initStore: (dbPath, DatabaseConstructor) => new ContentAddressedStore(dbPath, DatabaseConstructor)
};