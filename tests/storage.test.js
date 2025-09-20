/**
 * Storage Tests - Real tests for SQLite storage functionality
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
  return path.join(__dirname, `test-storage-${++testCounter}.sqlite`);
}

function cleanupTestDB(dbPath) {
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
  }
}

function testInitStore() {
  console.log('Testing initStore...');

  const testDB = getTestDB();

  const store = initStore(testDB);
  assert(store !== null, 'Store should be created');
  assert(typeof store.storeObject === 'function', 'Store should have storeObject method');
  assert(typeof store.getObject === 'function', 'Store should have getObject method');
  assert(typeof store.hasObject === 'function', 'Store should have hasObject method');
  assert(fs.existsSync(testDB), 'Database file should be created');

  const stats = store.getStats();
  assert(typeof stats === 'object', 'Stats should be object');
  assert(stats.dbPath === testDB, 'Stats should have correct path');
  assert(typeof stats.dbSize === 'number', 'Stats should have size');
  assert(typeof stats.objects === 'number', 'Stats should have object count');

  cleanupTestDB(testDB);
  console.log('✅ initStore tests passed');
}

function testBlobOperations() {
  console.log('Testing object operations...');

  const testDB = getTestDB();
  const store = initStore(testDB);

  // Test storing and retrieving objects
  const testData = new Uint8Array([1, 2, 3, 4, 5]);
  const result = store.storeObject(testData, 'blob');

  assert(typeof result === 'object', 'Result should be object');
  assert(typeof result.hash === 'string', 'Hash should be string');
  assert(result.hash.length === 64, 'Hash should be 64 characters (SHA-256)');
  assert(typeof result.isNew === 'boolean', 'isNew should be boolean');

  const retrieved = store.getObject(result.hash);
  assert(retrieved !== null, 'Retrieved object should exist');
  assert(retrieved.data instanceof Uint8Array, 'Retrieved data should be Uint8Array');
  assert(retrieved.data.length === testData.length, 'Retrieved data should have same length');
  assert(retrieved.data.every((byte, i) => byte === testData[i]), 'Retrieved data should match original');

  // Test non-existent object (valid hash format that doesn't exist)
  const nonExistent = store.getObject('0000000000000000000000000000000000000000000000000000000000000000');
  assert(nonExistent === null, 'Non-existent object should return null');

  // Test deduplication
  const result2 = store.storeObject(testData, 'blob');
  assert(result.hash === result2.hash, 'Same data should produce same hash');
  assert(result2.isNew === false, 'Second store should not be new (deduplication)');

  const stats = store.getStats();
  assert(stats.objects >= 1, 'Should have at least one object');

  cleanupTestDB(testDB);
  console.log('✅ Object operations tests passed');
}

function testMetadata() {
  console.log('Testing metadata operations...');
  
  const testDB = getTestDB();
  const store = initStore(testDB);
  
  // Test metadata storage and retrieval
  const testMeta = { test: 'value', number: 42, array: [1, 2, 3] };
  store.setMeta('test_key', JSON.stringify(testMeta));

  const retrieved = JSON.parse(store.getMeta('test_key'));
  assert(typeof retrieved === 'object', 'Metadata should be object');
  assert(retrieved.test === 'value', 'String property should match');
  assert(retrieved.number === 42, 'Number property should match');
  assert(Array.isArray(retrieved.array), 'Array property should be array');
  assert(retrieved.array.length === 3, 'Array should have correct length');
  
  // Test non-existent metadata
  const nonExistent = store.getMeta('non_existent');
  assert(nonExistent === null, 'Non-existent metadata should return null');
  
  // Test metadata update
  store.setMeta('test_key', JSON.stringify({ updated: true }));
  const updated = JSON.parse(store.getMeta('test_key'));
  assert(updated.updated === true, 'Metadata should be updated');
  assert(updated.test === undefined, 'Old metadata should be replaced');
  
  cleanupTestDB(testDB);
  console.log('✅ Metadata tests passed');
}

function testRefs() {
  console.log('Testing ref operations...');

  const testDB = getTestDB();
  const store = initStore(testDB);

  // Test initial state
  const refs = store.listRefs();
  assert(Array.isArray(refs), 'Refs should be array');
  assert(refs.length === 0, 'Should start with no refs');

  // Test ref creation
  const testHash = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
  store.setRef('refs/heads/main', testHash, 'branch');

  const refsAfterCreate = store.listRefs();
  assert(refsAfterCreate.length === 1, 'Should have one ref');
  assert(refsAfterCreate[0].name === 'refs/heads/main', 'Ref should be named correctly');
  assert(refsAfterCreate[0].hash === testHash, 'Ref should have correct hash');

  // Test ref retrieval
  const ref = store.getRef('refs/heads/main');
  assert(ref !== null, 'Ref should exist');
  assert(ref.hash === testHash, 'Retrieved ref should have correct hash');
  assert(ref.type === 'branch', 'Retrieved ref should have correct type');

  // Test ref update
  const newHash = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
  store.setRef('refs/heads/main', newHash, 'branch');
  const updatedRef = store.getRef('refs/heads/main');
  assert(updatedRef.hash === newHash, 'Ref should be updated');

  // Test ref removal
  const removed = store.removeRef('refs/heads/main');
  assert(removed === true, 'Ref removal should succeed');
  const deletedRef = store.getRef('refs/heads/main');
  assert(deletedRef === null, 'Removed ref should not exist');

  const refsAfterDelete = store.listRefs();
  assert(refsAfterDelete.length === 0, 'Should have no refs after deletion');

  cleanupTestDB(testDB);
  console.log('✅ Ref tests passed');
}

function testStats() {
  console.log('Testing database statistics...');

  const testDB = getTestDB();
  const store = initStore(testDB);

  const initialStats = store.getStats();
  assert(initialStats.objects === 0, 'Should start with 0 objects');
  assert(typeof initialStats.dbSize === 'number', 'Should have database size');

  // Add some data
  store.storeObject(new Uint8Array([1, 2, 3]), 'blob');
  store.storeObject(new Uint8Array([4, 5, 6]), 'blob');
  const updatedStats = store.getStats();
  assert(updatedStats.objects === 2, 'Should have 2 objects');
  assert(typeof updatedStats.dbSize === 'number', 'Should have database size');

  cleanupTestDB(testDB);
  console.log('✅ Statistics tests passed');
}

function testZlibCompression() {
  console.log('Testing zlib compression...');

  const testDB = getTestDB();
  const store = initStore(testDB);

  // Test data that should compress well (repeated pattern)
  const compressibleData = new Uint8Array(1000);
  compressibleData.fill(42); // All same byte - should compress dramatically

  // Test data that doesn't compress well (random-like)
  const randomData = new Uint8Array(1000);
  for (let i = 0; i < randomData.length; i++) {
    randomData[i] = (i * 127 + 13) % 256; // Pseudo-random pattern
  }

  // Store both types of data with compression
  const result1 = store.storeObject(compressibleData, 'blob', 'zlib');
  const result2 = store.storeObject(randomData, 'blob', 'zlib');

  // Verify data can be retrieved correctly (decompressed)
  const retrieved1 = store.getObject(result1.hash);
  const retrieved2 = store.getObject(result2.hash);
  
  assert(retrieved1.data instanceof Uint8Array, 'Retrieved compressible data should be Uint8Array');
  assert(retrieved1.data.length === compressibleData.length, 'Retrieved compressible data should have original length');
  assert(retrieved1.data.every((byte, i) => byte === compressibleData[i]), 'Retrieved compressible data should match original');

  assert(retrieved2.data instanceof Uint8Array, 'Retrieved random data should be Uint8Array');
  assert(retrieved2.data.length === randomData.length, 'Retrieved random data should have original length');
  assert(retrieved2.data.every((byte, i) => byte === randomData[i]), 'Retrieved random data should match original');
  
  // Test empty data compression
  const emptyData = new Uint8Array(0);
  const emptyResult = store.storeObject(emptyData, 'blob');
  const retrievedEmpty = store.getObject(emptyResult.hash);

  assert(retrievedEmpty.data.length === 0, 'Empty data should remain empty after compression/decompression');
  
  cleanupTestDB(testDB);
  console.log('✅ Zlib compression tests passed');
}

function testCompressionConsistency() {
  console.log('Testing compression consistency...');

  const testDB = getTestDB();
  const store = initStore(testDB);

  // Test that identical data produces identical compressed storage
  const testData = new TextEncoder().encode('This is test data that should compress consistently every time.');

  const result1 = store.storeObject(testData, 'blob');
  const result2 = store.storeObject(testData, 'blob'); // Should deduplicate, not create new blob

  assert(result1.hash === result2.hash, 'Identical data should produce identical hash');
  assert(result2.isNew === false, 'Second storage should be deduplicated');
  
  // Verify the data is still correct after decompression
  const retrieved = store.getObject(result1.hash);
  const retrievedText = new TextDecoder().decode(retrieved.data);
  const originalText = new TextDecoder().decode(testData);

  assert(retrievedText === originalText, 'Retrieved text should match original after compression/decompression');

  cleanupTestDB(testDB);
  console.log('✅ Compression consistency tests passed');
}

function testLargeFileCompression() {
  console.log('Testing large file compression...');

  const testDB = getTestDB();
  const store = initStore(testDB);

  // Create a large file (10KB) with pattern that should compress well
  const largeSize = 10 * 1024;
  const largeData = new Uint8Array(largeSize);

  // Fill with a repeating pattern that should compress very well
  const pattern = new TextEncoder().encode('WebDVCS test data pattern ');
  for (let i = 0; i < largeSize; i++) {
    largeData[i] = pattern[i % pattern.length];
  }

  const result = store.storeObject(largeData, 'blob');
  const retrieved = store.getObject(result.hash);

  assert(retrieved.data.length === largeData.length, 'Large file should have correct length after compression');
  assert(retrieved.data.every((byte, i) => byte === largeData[i]), 'Large file should match original after compression');

  cleanupTestDB(testDB);
  console.log('✅ Large file compression tests passed');
}

// Run all tests
function runStorageTests() {
  console.log('Running Storage Tests...\n');

  try {
    testInitStore();
    testBlobOperations();
    testZlibCompression();
    testCompressionConsistency();
    testLargeFileCompression();
    testMetadata();
    testRefs();
    testStats();

    console.log('\n✅ All storage tests passed!');
    return true;
  } catch (error) {
    console.error(`\n❌ Test failed: ${error.message}`);
    console.error(error.stack);
    return false;
  } finally {
    // Clean up test database files
    for (let i = 1; i <= testCounter; i++) {
      const testDb = path.join(__dirname, `test-storage-${i}.sqlite`);
      cleanupTestDB(testDb);
    }
  }
}

// Export for use by other test files
module.exports = { runStorageTests };

// Run tests if called directly
if (require.main === module) {
  process.exit(runStorageTests() ? 0 : 1);
}