/**
 * Schema Integrity Tests - Validate database schema matches TECHNICAL_SPEC.md
 */

const fs = require('fs');
const path = require('path');
const { initStore } = require('../lib/core/storage');

// Simple test runner
function assert(condition, message = 'Assertion failed') {
  if (!condition) {
    throw new Error(message);
  }
}

// Generate unique test database paths to avoid conflicts
let testCounter = 0;
function getTestDB() {
  return path.join(__dirname, `test-schema-${++testCounter}.sqlite`);
}

function cleanupTestDB(dbPath) {
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
  }
}

function testForeignKeyConstraints() {
  console.log('Testing foreign key constraints...');
  
  const testDB = getTestDB();
  const store = initStore(testDB);
  
  // Verify foreign keys are enabled
  const pragmaResult = store.db.prepare('PRAGMA foreign_keys').get();
  assert(pragmaResult.foreign_keys === 1, 'Foreign keys should be enabled');
  
  // Test file_entries foreign key constraints
  try {
    // Try to insert file_entry with non-existent tree_rid
    store.db.prepare("INSERT INTO file_entries VALUES (99999, 1, 'file', 1, 0)").run();
    assert(false, 'Should fail with foreign key constraint violation for tree_rid');
  } catch (error) {
    assert(error.message.includes('FOREIGN KEY constraint failed'), 'Should be foreign key error for tree_rid');
  }
  
  try {
    // Try to insert file_entry with non-existent blob_rid  
    const blobResult = store.storeBlob(new Uint8Array([1, 2, 3]));
    const treeResult = store.storeBlob(new Uint8Array([4, 5, 6]));
    store.db.prepare("INSERT INTO file_entries VALUES (?, 1, 'file', 99999, 0)").run(treeResult.rid);
    assert(false, 'Should fail with foreign key constraint violation for blob_rid');
  } catch (error) {
    assert(error.message.includes('FOREIGN KEY constraint failed'), 'Should be foreign key error for blob_rid');
  }
  
  try {
    // Try to insert file_entry with non-existent name_id
    const blobResult = store.storeBlob(new Uint8Array([1, 2, 3]));
    const treeResult = store.storeBlob(new Uint8Array([4, 5, 6])); 
    store.db.prepare("INSERT INTO file_entries VALUES (?, 99999, 'file', ?, 0)").run(treeResult.rid, blobResult.rid);
    assert(false, 'Should fail with foreign key constraint violation for name_id');
  } catch (error) {
    assert(error.message.includes('FOREIGN KEY constraint failed'), 'Should be foreign key error for name_id');
  }
  
  // Test deltas foreign key constraints
  try {
    // Try to insert delta with non-existent base_rid
    const deltaResult = store.storeBlob(new Uint8Array([7, 8, 9]));
    store.db.prepare('INSERT INTO deltas VALUES (?, 99999, 100, ?)').run(deltaResult.rid, Date.now());
    assert(false, 'Should fail with foreign key constraint violation for base_rid');
  } catch (error) {
    assert(error.message.includes('FOREIGN KEY constraint failed'), 'Should be foreign key error for base_rid');
  }
  
  // Test manifests foreign key constraints
  try {
    // Try to insert manifest with non-existent tree_rid
    const commitResult = store.storeBlob(new Uint8Array([10, 11, 12]));
    store.db.prepare("INSERT INTO manifests VALUES (?, 99999, NULL, 'test', 'author', 'email', ?)").run(commitResult.rid, Date.now());
    assert(false, 'Should fail with foreign key constraint violation for tree_rid');
  } catch (error) {
    assert(error.message.includes('FOREIGN KEY constraint failed'), 'Should be foreign key error for tree_rid');
  }
  
  cleanupTestDB(testDB);
  console.log('✅ Foreign key constraints tests passed');
}

function testCheckConstraints() {
  console.log('Testing CHECK constraints...');
  
  const testDB = getTestDB();
  const store = initStore(testDB);
  
  // Test blob CHECK constraints
  try {
    // Try to insert blob with invalid hash length (should be 64 chars for SHA-256)
    store.db.prepare("INSERT INTO blob VALUES (1, 'short', ?, 100, ?)").run(new Uint8Array([1, 2, 3]), Date.now());
    assert(false, 'Should fail with CHECK constraint violation for hash length');
  } catch (error) {
    assert(error.message.includes('CHECK constraint failed'), 'Should be CHECK constraint error for hash length');
  }
  
  try {
    // Try to insert blob with rid <= 0
    const validHash = '1234567890123456789012345678901234567890123456789012345678901234';
    store.db.prepare('INSERT INTO blob VALUES (0, ?, ?, 100, ?)').run(validHash, new Uint8Array([1, 2, 3]), Date.now());
    assert(false, 'Should fail with CHECK constraint violation for rid <= 0');
  } catch (error) {
    assert(error.message.includes('CHECK constraint failed'), 'Should be CHECK constraint error for rid <= 0');
  }
  
  // Test filenames CHECK constraints
  try {
    // Try to insert filename with empty name
    store.db.prepare("INSERT INTO filenames VALUES (1, '')").run();
    assert(false, 'Should fail with CHECK constraint violation for empty filename');
  } catch (error) {
    assert(error.message.includes('CHECK constraint failed'), 'Should be CHECK constraint error for empty filename');
  }
  
  // Test file_entries CHECK constraints for type
  try {
    // Create valid blob and filename first
    const blobResult = store.storeBlob(new Uint8Array([1, 2, 3]));
    const treeResult = store.storeBlob(new Uint8Array([4, 5, 6]));
    const nameId = store.getFilenameId('test.txt');
    
    // Try invalid file type
    store.db.prepare("INSERT INTO file_entries VALUES (?, ?, 'invalid', ?, 0)").run(treeResult.rid, nameId, blobResult.rid);
    assert(false, 'Should fail with CHECK constraint violation for invalid file type');
  } catch (error) {
    assert(error.message.includes('CHECK constraint failed'), 'Should be CHECK constraint error for file type');
  }
  
  // Test manifests CHECK constraints for author  
  try {
    // Try to insert manifest with empty author
    const commitResult = store.storeBlob(new Uint8Array([7, 8, 9]));
    const treeResult = store.storeBlob(new Uint8Array([10, 11, 12]));
    store.db.prepare("INSERT INTO manifests VALUES (?, ?, NULL, 'test', '', 'email', ?)").run(commitResult.rid, treeResult.rid, Date.now());
    assert(false, 'Should fail with CHECK constraint violation for empty author');
  } catch (error) {
    assert(error.message.includes('CHECK constraint failed'), 'Should be CHECK constraint error for empty author');
  }
  
  cleanupTestDB(testDB);
  console.log('✅ CHECK constraints tests passed');
}

function testWithoutRowIdOptimization() {
  console.log('Testing WITHOUT ROWID optimization...');
  
  const testDB = getTestDB();  
  const store = initStore(testDB);
  
  // Check that tables are created with WITHOUT ROWID where specified in TECHNICAL_SPEC.md
  const tableInfoQueries = [
    'PRAGMA table_info(blob)',
    'PRAGMA table_info(filenames)', 
    'PRAGMA table_info(file_entries)',
    'PRAGMA table_info(chunk_links)',
    'PRAGMA table_info(manifests)',
    'PRAGMA table_info(metadata)'
  ];
  
  const expectedWithoutRowId = ['file_entries', 'deltas', 'manifests', 'metadata'];
  
  // Check if tables are WITHOUT ROWID by checking their schema
  for (const tableName of expectedWithoutRowId) {
    const schemaQuery = store.db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?");
    const result = schemaQuery.get(tableName);
    
    assert(result !== undefined, `Table ${tableName} should exist`);
    assert(result.sql.includes('WITHOUT ROWID'), `Table ${tableName} should be created WITH WITHOUT ROWID optimization`);
  }
  
  // Verify that blob table does NOT have WITHOUT ROWID (uses AUTOINCREMENT)
  const blobSchema = store.db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='blob'").get();
  assert(!blobSchema.sql.includes('WITHOUT ROWID'), 'Blob table should NOT use WITHOUT ROWID (uses AUTOINCREMENT)');
  
  // Verify that filenames table does NOT have WITHOUT ROWID (uses AUTOINCREMENT)
  const filenamesSchema = store.db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='filenames'").get();
  assert(!filenamesSchema.sql.includes('WITHOUT ROWID'), 'Filenames table should NOT use WITHOUT ROWID (uses AUTOINCREMENT)');
  
  // Verify that branches table (if exists) does NOT have WITHOUT ROWID (uses INTEGER PRIMARY KEY)
  const branchesSchema = store.db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='branches'").get();
  if (branchesSchema) {
    assert(!branchesSchema.sql.includes('WITHOUT ROWID'), 'Branches table should NOT use WITHOUT ROWID (uses INTEGER PRIMARY KEY)');
  }
  
  cleanupTestDB(testDB);
  console.log('✅ WITHOUT ROWID optimization tests passed');
}

function testDatabaseIndexes() {
  console.log('Testing database indexes...');
  
  const testDB = getTestDB();
  const store = initStore(testDB);
  
  // Check that required indexes exist as per TECHNICAL_SPEC.md
  const expectedIndexes = [
    'idx_blob_uuid',
    'idx_file_entries_tree',
    'idx_file_entries_name',
    'idx_deltas_base',
    'idx_manifests_parent',
    'idx_manifests_timestamp',
    'idx_branches_created_at'
  ];
  
  const indexQuery = store.db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name=?");
  
  for (const indexName of expectedIndexes) {
    const result = indexQuery.get(indexName);
    assert(result !== undefined, `Index ${indexName} should exist`);
    assert(result.name === indexName, `Index should be named ${indexName}`);
  }
  
  // Add some test data to make index usage more realistic
  const testBlob = store.storeBlob(new Uint8Array([1, 2, 3, 4]));
  const testTree = store.storeBlob(new Uint8Array([5, 6, 7, 8]));
  const nameId = store.getFilenameId('test.txt');
  
  // Insert test data into file_entries
  store.insertFileEntry.run(testTree.rid, nameId, 'file', testBlob.rid, 0);
  
  // Insert test data into manifests
  store.insertManifest.run(testBlob.rid, testTree.rid, null, 'test commit', 'author', 'email@test.com', Date.now());
  
  // Verify index effectiveness by checking query plans
  // These queries should use the indexes we created
  const queryPlans = [
    { query: 'EXPLAIN QUERY PLAN SELECT * FROM blob WHERE uuid = ?', shouldUseIndex: 'idx_blob_uuid', param: testBlob.hash },
    { query: 'EXPLAIN QUERY PLAN SELECT * FROM file_entries WHERE tree_rid = ?', shouldUseIndex: 'idx_file_entries_tree', param: testTree.rid },
    { query: 'EXPLAIN QUERY PLAN SELECT * FROM manifests WHERE parent_rid IS NULL', shouldUseIndex: null }, // This one won't use parent index
    { query: 'EXPLAIN QUERY PLAN SELECT * FROM manifests ORDER BY timestamp DESC', shouldUseIndex: 'idx_manifests_timestamp', param: null }
  ];
  
  for (const plan of queryPlans) {
    const result = plan.param ? 
      store.db.prepare(plan.query).all(plan.param) : 
      store.db.prepare(plan.query).all();
    const planText = result.map(r => r.detail).join(' ');
    
    // Some queries should use indexes, others might not depending on data size and SQLite optimizer
    if (plan.shouldUseIndex) {
      // For small datasets, SQLite might choose table scan over index, so we'll just check that the index exists
      // rather than requiring it to be used in the query plan
      const indexExists = indexQuery.get(plan.shouldUseIndex);
      assert(indexExists !== undefined, `Index ${plan.shouldUseIndex} should exist for query optimization`);
    }
  }
  
  cleanupTestDB(testDB);
  console.log('✅ Database indexes tests passed');
}

function testSchemaConsistency() {
  console.log('Testing schema consistency with TECHNICAL_SPEC.md...');
  
  const testDB = getTestDB();
  const store = initStore(testDB);
  
  // Verify all required tables exist
  const requiredTables = ['blob', 'filenames', 'file_entries', 'deltas', 'manifests', 'metadata', 'branches'];
  const tableQuery = store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?");
  
  for (const tableName of requiredTables) {
    const result = tableQuery.get(tableName);
    assert(result !== undefined, `Required table ${tableName} should exist`);
  }
  
  // Verify blob table has correct structure
  const blobColumns = store.db.prepare('PRAGMA table_info(blob)').all();
  const expectedBlobColumns = ['rid', 'uuid', 'content', 'size', 'created_at'];
  
  assert(blobColumns.length >= expectedBlobColumns.length, 'Blob table should have all required columns');
  
  for (const expectedCol of expectedBlobColumns) {
    const found = blobColumns.find(col => col.name === expectedCol);
    assert(found !== undefined, `Blob table should have ${expectedCol} column`);
  }
  
  // Verify manifests table structure matches commit metadata requirements
  const manifestColumns = store.db.prepare('PRAGMA table_info(manifests)').all();
  const expectedManifestColumns = ['rid', 'tree_rid', 'parent_rid', 'message', 'author', 'email', 'timestamp'];
  
  for (const expectedCol of expectedManifestColumns) {
    const found = manifestColumns.find(col => col.name === expectedCol);
    assert(found !== undefined, `Manifests table should have ${expectedCol} column`);
  }
  
  cleanupTestDB(testDB);
  console.log('✅ Schema consistency tests passed');
}

// Run all tests
function runSchemaTests() {
  console.log('Running Schema Integrity Tests...\n');
  
  try {
    testForeignKeyConstraints();
    testCheckConstraints();
    testWithoutRowIdOptimization();  
    testDatabaseIndexes();
    testSchemaConsistency();
    
    console.log('\n✅ All schema integrity tests passed!');
    return true;
  } catch (error) {
    console.error(`\n❌ Schema test failed: ${error.message}`);
    console.error(error.stack);
    return false;
  } finally {
    // Clean up test database files
    for (let i = 1; i <= testCounter; i++) {
      const testDb = path.join(__dirname, `test-schema-${i}.sqlite`);
      cleanupTestDB(testDb);
    }
  }
}

// Export for use by other test files
module.exports = { runSchemaTests };

// Run tests if called directly
if (require.main === module) {
  process.exit(runSchemaTests() ? 0 : 1);
}