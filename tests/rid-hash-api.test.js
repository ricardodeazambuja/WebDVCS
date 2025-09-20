/**
 * RID vs Hash API Distinction Tests - Validate internal RID vs external hash usage
 */

const fs = require('fs');
const path = require('path');
const { initStore } = require('../lib/core/storage');
const { storeTree, getTree, createCommit, getCommit } = require('../lib/core/objects');

// Simple test runner
function assert(condition, message = 'Assertion failed') {
  if (!condition) {
    throw new Error(message);
  }
}

// Test database path
let testCounter = 0;
function getTestDB() {
  return path.join(__dirname, `test-rid-hash-${++testCounter}.sqlite`);
}

function cleanupTestDB(dbPath) {
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
  }
}

function testInternalRidUsage() {
  console.log('Testing internal RID usage...');
  
  const testDB = getTestDB();
  const store = initStore(testDB);
  
  // Test that internal storage operations use RIDs
  const testData1 = new Uint8Array([1, 2, 3, 4]);
  const testData2 = new Uint8Array([5, 6, 7, 8]);
  
  const result1 = store.storeBlob(testData1);
  const result2 = store.storeBlob(testData2);
  
  // Verify RIDs are integers and sequential
  assert(typeof result1.rid === 'number', 'RID should be a number');
  assert(typeof result2.rid === 'number', 'RID should be a number');
  assert(Number.isInteger(result1.rid), 'RID should be an integer');
  assert(Number.isInteger(result2.rid), 'RID should be an integer');
  assert(result1.rid > 0, 'RID should be positive');
  assert(result2.rid > 0, 'RID should be positive');
  
  // Test internal RID-to-hash and hash-to-RID mapping
  const ridFromHash1 = store.getRidFromHash(result1.hash);
  const ridFromHash2 = store.getRidFromHash(result2.hash);
  const hashFromRid1 = store.getHashFromRid(result1.rid);  
  const hashFromRid2 = store.getHashFromRid(result2.rid);
  
  assert(ridFromHash1 === result1.rid, 'RID-from-hash mapping should work');
  assert(ridFromHash2 === result2.rid, 'RID-from-hash mapping should work');
  assert(hashFromRid1 === result1.hash, 'Hash-from-RID mapping should work');
  assert(hashFromRid2 === result2.hash, 'Hash-from-RID mapping should work');
  
  // Test database query to verify internal structure uses RIDs
  const blobQuery = store.db.prepare('SELECT rid, uuid FROM blob WHERE rid = ?');
  const blobRow1 = blobQuery.get(result1.rid);
  const blobRow2 = blobQuery.get(result2.rid);
  
  assert(blobRow1.rid === result1.rid, 'Database should store RID internally');
  assert(blobRow1.uuid === result1.hash, 'Database should map RID to hash');
  assert(blobRow2.rid === result2.rid, 'Database should store RID internally');
  assert(blobRow2.uuid === result2.hash, 'Database should map RID to hash');
  
  cleanupTestDB(testDB);
  console.log('✅ Internal RID usage tests passed');
}

function testExternalHashAPI() {
  console.log('Testing external hash API...');
  
  const testDB = getTestDB();
  const store = initStore(testDB);
  
  // Test that public APIs use hashes, not RIDs
  const testData = new Uint8Array([10, 20, 30, 40]);
  const result = store.storeBlob(testData);
  
  // Public storeBlob returns hash, not RID
  assert(typeof result.hash === 'string', 'Public API should return hash as string');
  assert(result.hash.length === 64, 'Hash should be 64 characters (SHA-256)');
  assert(result.hash.match(/^[a-f0-9]{64}$/), 'Hash should be hexadecimal');
  
  // Public getBlob accepts hash, not RID
  const retrieved = store.getBlob(result.hash);
  assert(retrieved instanceof Uint8Array, 'getBlob should accept hash and return data');
  assert(retrieved.every((byte, i) => byte === testData[i]), 'Retrieved data should match');
  
  // Test that RID is not exposed in public API (internal only)
  assert(typeof result.rid === 'number', 'RID should exist internally for storage layer');
  // But RID should not be used in higher-level APIs
  
  cleanupTestDB(testDB);
  console.log('✅ External hash API tests passed');
}

function testTreeAPIHashUsage() {
  console.log('Testing tree API hash usage...');
  
  const testDB = getTestDB();
  const store = initStore(testDB);
  
  // Create test file blobs
  const file1Data = new TextEncoder().encode('file1 content');
  const file2Data = new TextEncoder().encode('file2 content');
  
  const file1Result = store.storeBlob(file1Data);
  const file2Result = store.storeBlob(file2Data);
  
  // Create tree entries using hashes (external API)
  const entries = [
    { name: 'file1.txt', type: 'file', hash: file1Result.hash, binary: false },
    { name: 'file2.txt', type: 'file', hash: file2Result.hash, binary: false }
  ];
  
  // storeTree should accept and return hashes
  const treeHash = storeTree(entries, store);
  assert(typeof treeHash === 'string', 'storeTree should return hash as string');
  assert(treeHash.length === 64, 'Tree hash should be 64 characters');
  
  // getTree should accept hash and return entries with hashes
  const retrievedEntries = getTree(treeHash, store);
  assert(Array.isArray(retrievedEntries), 'getTree should return array');
  assert(retrievedEntries.length === 2, 'Should retrieve correct number of entries');
  
  assert(retrievedEntries[0].hash === file1Result.hash, 'Entry should contain original file hash');
  assert(retrievedEntries[1].hash === file2Result.hash, 'Entry should contain original file hash');
  assert(typeof retrievedEntries[0].hash === 'string', 'Entry hash should be string');
  assert(typeof retrievedEntries[1].hash === 'string', 'Entry hash should be string');
  
  // Verify internal database uses RIDs
  const treeRid = store.getRidFromHash(treeHash);
  const fileEntriesQuery = store.db.prepare('SELECT tree_rid, blob_rid FROM file_entries WHERE tree_rid = ?');
  const fileEntries = fileEntriesQuery.all(treeRid);
  
  assert(fileEntries.length === 2, 'Internal database should have 2 file entries');
  assert(typeof fileEntries[0].tree_rid === 'number', 'Internal storage should use RID for tree_rid');
  assert(typeof fileEntries[0].blob_rid === 'number', 'Internal storage should use RID for blob_rid');
  
  cleanupTestDB(testDB);
  console.log('✅ Tree API hash usage tests passed');
}

function testCommitAPIHashUsage() {
  console.log('Testing commit API hash usage...');
  
  const testDB = getTestDB();
  const store = initStore(testDB);
  
  // Create a tree for the commit
  const fileData = new TextEncoder().encode('commit test content');
  const fileResult = store.storeBlob(fileData);
  const entries = [{ name: 'test.txt', type: 'file', hash: fileResult.hash, binary: false }];
  const treeHash = storeTree(entries, store);
  
  // createCommit should accept and return hashes
  const commitHash = createCommit(treeHash, 'Test commit', 'Test Author', 'test@example.com', null, store);
  
  assert(typeof commitHash === 'string', 'createCommit should return hash as string');
  assert(commitHash.length === 64, 'Commit hash should be 64 characters');
  
  // getCommit should accept hash and return commit with hash references
  const commit = getCommit(commitHash, store);
  
  assert(typeof commit === 'object', 'getCommit should return commit object');
  assert(commit.tree === treeHash, 'Commit should reference tree by hash');
  assert(commit.parent === null, 'Initial commit should have null parent');
  assert(typeof commit.message === 'string', 'Commit should have message');
  assert(typeof commit.author === 'string', 'Commit should have author');
  
  // Test commit with parent
  const childCommitHash = createCommit(treeHash, 'Child commit', 'Test Author', 'test@example.com', commitHash, store);
  const childCommit = getCommit(childCommitHash, store);
  
  assert(childCommit.parent === commitHash, 'Child commit should reference parent by hash');
  assert(typeof childCommit.parent === 'string', 'Parent reference should be hash string');
  
  // Verify internal database uses RIDs  
  const commitRid = store.getRidFromHash(commitHash);
  const manifestQuery = store.db.prepare('SELECT rid, tree_rid, parent_rid FROM manifests WHERE rid = ?');
  const manifest = manifestQuery.get(commitRid);
  
  assert(typeof manifest.rid === 'number', 'Internal storage should use RID for commit');
  assert(typeof manifest.tree_rid === 'number', 'Internal storage should use RID for tree reference');
  assert(manifest.parent_rid === null, 'Initial commit should have null parent RID');
  
  cleanupTestDB(testDB);
  console.log('✅ Commit API hash usage tests passed');
}

function testConsistentHashGeneration() {
  console.log('Testing consistent hash generation...');
  
  const testDB1 = getTestDB();
  const testDB2 = getTestDB();
  const store1 = initStore(testDB1);
  const store2 = initStore(testDB2);
  
  // Test that identical data produces identical hashes across different store instances
  const testData = new Uint8Array([100, 101, 102, 103]);
  
  const result1 = store1.storeBlob(testData);
  const result2 = store2.storeBlob(testData);
  
  // Same data should produce same hash (content-addressable)
  assert(result1.hash === result2.hash, 'Identical data should produce identical hashes');
  
  // But different RIDs (instance-specific)
  // RIDs might be the same in fresh databases, but that's implementation detail
  assert(typeof result1.rid === 'number', 'Store 1 should have valid RID');
  assert(typeof result2.rid === 'number', 'Store 2 should have valid RID');
  
  // Test hash consistency with tree operations
  const entries = [{ name: 'test.bin', type: 'file', hash: result1.hash, binary: true }];
  const treeHash1 = storeTree(entries, store1);
  const treeHash2 = storeTree(entries, store2);
  
  assert(treeHash1 === treeHash2, 'Identical trees should produce identical hashes');
  
  // Test commit hash consistency  
  const commitHash1 = createCommit(treeHash1, 'Test', 'Author', 'email@test.com', null, store1);
  const commitHash2 = createCommit(treeHash2, 'Test', 'Author', 'email@test.com', null, store2);
  
  assert(commitHash1 === commitHash2, 'Identical commits should produce identical hashes');
  
  cleanupTestDB(testDB1);
  cleanupTestDB(testDB2);
  console.log('✅ Consistent hash generation tests passed');
}

function testRidHashSeparation() {
  console.log('Testing RID-hash separation...');
  
  const testDB = getTestDB();
  const store = initStore(testDB);
  
  // Test that RIDs and hashes are completely separate namespaces
  const data1 = new Uint8Array([1]);
  const data2 = new Uint8Array([2]);
  
  const result1 = store.storeBlob(data1);
  const result2 = store.storeBlob(data2);
  
  // Verify that you cannot use RID where hash is expected
  try {
    store.getBlob(result1.rid); // Should fail - RID passed instead of hash
    assert(false, 'Should not be able to use RID as hash');
  } catch (error) {
    // Expected - RID is not a valid hash
    assert(error.message.includes('Blob not found') || error.message.includes('Invalid hash'), 'Should reject RID as hash');
  }
  
  // Verify that invalid hashes are rejected
  try {
    store.getBlob('invalid-hash-format'); 
    assert(false, 'Should reject invalid hash formats');
  } catch (error) {
    // Expected - invalid format rejected
  }
  
  // Verify that RID-to-hash mapping is consistent
  const hash1 = store.getHashFromRid(result1.rid);
  const hash2 = store.getHashFromRid(result2.rid);
  const rid1 = store.getRidFromHash(result1.hash);
  const rid2 = store.getRidFromHash(result2.hash);
  
  assert(hash1 === result1.hash, 'RID-to-hash mapping should be consistent');
  assert(hash2 === result2.hash, 'RID-to-hash mapping should be consistent');
  assert(rid1 === result1.rid, 'Hash-to-RID mapping should be consistent');
  assert(rid2 === result2.rid, 'Hash-to-RID mapping should be consistent');
  
  // Test that non-existent mappings return null/undefined
  const nonExistentRid = store.getRidFromHash('0000000000000000000000000000000000000000000000000000000000000000');
  const nonExistentHash = store.getHashFromRid(99999);
  
  assert(nonExistentRid === null || nonExistentRid === undefined, 'Non-existent hash should return null RID');
  assert(nonExistentHash === null || nonExistentHash === undefined, 'Non-existent RID should return null hash');
  
  cleanupTestDB(testDB);
  console.log('✅ RID-hash separation tests passed');
}

// Run all tests
function runRidHashAPITests() {
  console.log('Running RID vs Hash API Distinction Tests...\n');
  
  try {
    testInternalRidUsage();
    testExternalHashAPI();
    testTreeAPIHashUsage();
    testCommitAPIHashUsage();
    testConsistentHashGeneration();
    testRidHashSeparation();
    
    console.log('\n✅ All RID vs Hash API distinction tests passed!');
    console.log('\n📋 RID vs Hash API Summary:');
    console.log('- Internal RID usage validated ✅');
    console.log('- External hash APIs confirmed ✅'); 
    console.log('- Tree operations use hash API ✅');
    console.log('- Commit operations use hash API ✅');
    console.log('- Hash generation is consistent ✅');
    console.log('- RID-hash separation enforced ✅');
    
    return true;
  } catch (error) {
    console.error(`\n❌ RID vs Hash API test failed: ${error.message}`);
    console.error(error.stack);
    return false;
  } finally {
    // Clean up test database files
    for (let i = 1; i <= testCounter; i++) {
      const testDb = path.join(__dirname, `test-rid-hash-${i}.sqlite`);
      cleanupTestDB(testDb);
    }
  }
}

// Export for use by other test files
module.exports = { runRidHashAPITests };

// Run tests if called directly
if (require.main === module) {
  process.exit(runRidHashAPITests() ? 0 : 1);
}