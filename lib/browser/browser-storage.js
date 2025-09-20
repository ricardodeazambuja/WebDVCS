/**
 * Browser Storage Adapter
 * Minimal adapter to use sql.js with the shared core storage layer
 * 
 * This file ONLY handles the Database constructor difference.
 * All VCS logic is shared from lib/core/
 */

/**
 * Browser-compatible Database wrapper for sql.js
 * Implements the same interface as better-sqlite3 for compatibility
 */
class BrowserDatabase {
  constructor(dbPathOrData) {
    this.dbPath = typeof dbPathOrData === 'string' ? dbPathOrData : 'webdvcs.sqlite';
    
    // Check if SQL.js is loaded (support both window and worker environments)
    const global = typeof window !== 'undefined' ? window : self;
    if (typeof global.initSqlJs === 'undefined') {
      throw new Error('SQL.js not loaded. Include sql.js before using WebDVCS browser interface.');
    }
    
    // Initialize with existing data or create new database
    const SQL = global.SQL;
    if (!SQL) {
      throw new Error('SQL.js Database not available. Make sure SQL.js is properly initialized.');
    }

    if (dbPathOrData instanceof Uint8Array) {
      this.db = new SQL.Database(dbPathOrData);
    } else {
      this.db = new SQL.Database();
    }
  }

  /**
   * Execute SQL statement (compatible with better-sqlite3)
   */
  exec(sql) {
    return this.db.exec(sql);
  }

  /**
   * Prepare statement (compatible with better-sqlite3)
   * Fixed: Create fresh statements on each method call to avoid "Statement closed" errors
   * This ensures statements are always valid even after VACUUM or export operations
   */
  prepare(sql) {
    // Store the SQL string to prepare fresh statements on demand
    const preparedSql = sql;
    const db = this.db;

    // Wrap with better-sqlite3 compatible interface
    return {
      run: (...params) => {
        // Create fresh statement for each run
        const stmt = db.prepare(preparedSql);
        try {
          stmt.bind(params);

          // Execute the statement and get proper change count
          stmt.step();

          // Use SQL changes() function for accurate change count (especially for INSERT OR IGNORE)
          let changes = 1; // Default for most operations
          try {
            const changeResult = db.exec("SELECT changes()")[0];
            if (changeResult && changeResult.values && changeResult.values[0]) {
              changes = changeResult.values[0][0] || 0;
            }
          } catch (e) {
            // Fallback to 1 if changes() function fails
            changes = 1;
          }

          // Get lastInsertRowid before freeing the statement
          let lastInsertRowid = 0;
          try {
            const rowidResult = db.exec("SELECT last_insert_rowid() as id")[0];
            if (rowidResult && rowidResult.values && rowidResult.values[0]) {
              lastInsertRowid = rowidResult.values[0][0] || 0;
            }
          } catch (e) {
            lastInsertRowid = 0;
          }

          return {
            changes,
            lastInsertRowid
          };
        } finally {
          // Always free the statement after use (sql.js only)
          if (typeof stmt.free === 'function') {
            stmt.free();
          }
        }
      },

      get: (...params) => {
        // Create fresh statement for each get
        const stmt = db.prepare(preparedSql);
        try {
          stmt.bind(params);
          const result = stmt.step();

          if (result) {
            // Special handling for blob table BLOB columns in sql.js
            if (preparedSql.includes('FROM blob') || preparedSql.includes('blob WHERE')) {
              // For blob table, manually construct object to handle BLOB column correctly
              const columns = stmt.getColumnNames();
              const values = stmt.get();
              const obj = {};
              for (let i = 0; i < columns.length; i++) {
                const colName = columns[i];
                obj[colName] = values[i];
              }
              return obj;
            } else {
              // For other tables, use standard getAsObject
              const obj = stmt.getAsObject();
              return obj;
            }
          }
          return undefined;
        } finally {
          // Always free the statement after use (sql.js only)
          if (typeof stmt.free === 'function') {
            stmt.free();
          }
        }
      },

      all: (...params) => {
        // Create fresh statement for each all
        const stmt = db.prepare(preparedSql);
        try {
          stmt.bind(params);

          const results = [];
          while (stmt.step()) {
            // Special handling for blob table BLOB columns in sql.js
            if (preparedSql.includes('FROM blob') || preparedSql.includes('blob WHERE')) {
              // For blob table, manually construct object to handle BLOB column correctly
              const columns = stmt.getColumnNames();
              const values = stmt.get();
              const obj = {};
              for (let i = 0; i < columns.length; i++) {
                const colName = columns[i];
                obj[colName] = values[i];
              }
              results.push(obj);
            } else {
              // For other tables, use standard getAsObject
              results.push(stmt.getAsObject());
            }
          }
          return results;
        } finally {
          // Always free the statement after use (sql.js only)
          if (typeof stmt.free === 'function') {
            stmt.free();
          }
        }
      },

      // No-op since statements are freed immediately after use
      free: () => {
        // Nothing to free - statements are freed after each operation
      }
    };
  }

  /**
   * Close database connection
   */
  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  /**
   * Transaction support for sql.js (compatible with better-sqlite3)
   */
  transaction(fn) {
    return () => {
      try {
        this.db.exec('BEGIN');
        const result = fn();
        this.db.exec('COMMIT');
        return result;
      } catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
      }
    };
  }

  /**
   * Export database as Uint8Array (browser-specific)
   */
  export() {
    return this.db.export();
  }

  /**
   * Get database file path (for compatibility)
   */
  name() {
    return this.dbPath;
  }
}

/**
 * Initialize SQL.js and return the Database constructor
 * @param {Object} config - SQL.js configuration options
 * @returns {Promise<Function>} Database constructor ready for use
 */
async function initBrowserSQL(config = {}) {
  // Support both window and worker environments
  const global = typeof window !== 'undefined' ? window : self;

  // Default configuration for SQL.js
  const defaultConfig = {
    locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.13.0/${file}`
  };

  const sqlConfig = { ...defaultConfig, ...config };

  // Initialize SQL.js
  if (!global.SQL) {
    global.SQL = await global.initSqlJs(sqlConfig);
  }

  return BrowserDatabase;
}

/**
 * Create storage instance with sql.js for browser use
 * @param {string|Uint8Array} dbPathOrData - Database path or existing data
 * @param {Object} sqlConfig - SQL.js configuration  
 * @returns {Promise<Object>} Storage instance using shared core logic
 */
async function createBrowserStorage(dbPathOrData = 'webdvcs.sqlite', sqlConfig = {}) {
  // Get browser-compatible Database constructor
  const DatabaseConstructor = await initBrowserSQL(sqlConfig);
  
  // Import shared core storage (all VCS logic)
  const { initStore } = await import('../core/storage.js');
  
  // Create storage using shared core logic with injected Database constructor
  return initStore(dbPathOrData, DatabaseConstructor);
}

/**
 * Load existing repository from uploaded file
 * @param {File} file - SQLite file from user upload
 * @param {Object} sqlConfig - SQL.js configuration
 * @returns {Promise<Object>} Storage instance with loaded repository
 */
async function loadRepositoryFromFile(file, sqlConfig = {}) {
  const arrayBuffer = await file.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);
  
  return createBrowserStorage(uint8Array, sqlConfig);
}

/**
 * Export repository as downloadable SQLite file
 * @param {Object} storage - Storage instance
 * @param {string} filename - Download filename
 * @returns {Blob} SQLite file as blob for download
 */
function exportRepositoryAsFile(storage, filename = 'webdvcs-repo.sqlite') {
  const dbData = storage.db.export();
  return new Blob([dbData], { type: 'application/x-sqlite3' });
}

// Browser exports (CommonJS for webpack compatibility)
module.exports = {
  BrowserDatabase,
  initBrowserSQL,
  createBrowserStorage,
  loadRepositoryFromFile,
  exportRepositoryAsFile
};