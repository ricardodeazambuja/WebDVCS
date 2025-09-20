/**
 * Objects Tests - Real tests for tree and commit functionality
 */

const fs = require('fs');
const path = require('path');
const { storeBlob, getBlob, storeTree, getTree, createCommit, getCommit, getCommitHistory, commitExists, getTreeFiles } = require('../lib/core/objects');
const { initStore } = require('../lib/core/storage');

// Simple test runner
function assert(condition, message = 'Assertion failed') {
  if (!condition) {
    throw new Error(message);
  }
}

// Test database path
const TEST_DB = path.join(__dirname, 'test-objects.sqlite');

function cleanupTestDB() {
  if (fs.existsSync(TEST_DB)) {
    fs.unlinkSync(TEST_DB);
  }
}

function testStoreTree() {
  console.log('Testing storeTree...');
  
  cleanupTestDB();
  const store = initStore(TEST_DB);
  
  // Test empty tree
  const emptyEntries = [];
  const emptyTreeHash = storeTree(emptyEntries, store);
  assert(typeof emptyTreeHash === 'string', 'Empty tree hash should be string');
  assert(emptyTreeHash.length === 64, 'Empty tree hash should be 64 characters (SHA-256)');
  
  // Test tree with files - create real blobs first
  const file1Result = storeBlob(new TextEncoder().encode('file1 content'), store);
  const file2Result = storeBlob(new Uint8Array([1, 2, 3, 4]), store); // binary data
  const subdirResult = storeBlob(new Uint8Array(0), store); // empty blob for subdir
  
  const fileEntries = [
    { name: 'file1.txt', type: 'file', hash: file1Result.hash, binary: false, mode: 0o644, mtime: Date.now(), size: 12, target: null },
    { name: 'file2.bin', type: 'file', hash: file2Result.hash, binary: true, mode: 0o644, mtime: Date.now(), size: 4, target: null },
    { name: 'subdir', type: 'dir', hash: subdirResult.hash, binary: false, mode: 0o755, mtime: Date.now(), size: 0, target: null }
  ];
  
  const treeHash = storeTree(fileEntries, store);
  assert(typeof treeHash === 'string', 'Tree hash should be string');
  assert(treeHash.length === 64, 'Tree hash should be 64 characters (SHA-256)');
  
  console.log('✅ storeTree tests passed');
}

function testGetTree() {
  console.log('Testing getTree...');
  
  cleanupTestDB();
  const store = initStore(TEST_DB);
  
  // Create real blobs for test entries
  const readmeResult = storeBlob(new TextEncoder().encode('readme content'), store);
  const imageResult = storeBlob(new Uint8Array([0x89, 0x50, 0x4E, 0x47]), store); // PNG header bytes
  
  const originalEntries = [
    { name: 'readme.txt', type: 'file', hash: readmeResult.hash, binary: false, mode: 0o644, mtime: Date.now(), size: 14, target: null },
    { name: 'image.png', type: 'file', hash: imageResult.hash, binary: true, mode: 0o644, mtime: Date.now(), size: 4, target: null }
  ];
  
  const treeHash = storeTree(originalEntries, store);
  const retrievedEntries = getTree(treeHash, store);
  
  assert(Array.isArray(retrievedEntries), 'Retrieved entries should be array');
  assert(retrievedEntries.length === originalEntries.length, 'Retrieved entries should have same length');
  
  // Sort original entries for comparison (storeTree sorts by name)
  const sortedOriginal = [...originalEntries].sort((a, b) => a.name.localeCompare(b.name));

  for (let i = 0; i < sortedOriginal.length; i++) {
    assert(retrievedEntries[i].name === sortedOriginal[i].name, `Entry ${i} name should match`);
    assert(retrievedEntries[i].type === sortedOriginal[i].type, `Entry ${i} type should match`);
    assert(retrievedEntries[i].hash === sortedOriginal[i].hash, `Entry ${i} hash should match`);
    // Note: binary flag is not preserved in tree serialization format
  }
  
  console.log('✅ getTree tests passed');
}

function testGetTreeErrors() {
  console.log('Testing getTree error handling...');
  
  cleanupTestDB();
  const store = initStore(TEST_DB);
  
  // Test non-existent tree
  const result = getTree('xxxx', store);
  assert(result === null, 'Should return null for non-existent tree');
  
  console.log('✅ getTree error handling tests passed');
}

function testCreateCommit() {
  console.log('Testing createCommit...');
  
  cleanupTestDB();
  const store = initStore(TEST_DB);
  
  // Create a tree first - create real blob for entry
  const testResult = storeBlob(new TextEncoder().encode('test file content'), store);
  const entries = [{ name: 'test.txt', type: 'file', hash: testResult.hash, binary: false, mode: 0o644, mtime: Date.now(), size: 17, target: null }];
  const treeHash = storeTree(entries, store);
  
  // Test initial commit (no parent)
  const commitHash = createCommit(treeHash, 'Initial commit', 'Test Author', 'test@example.com', null, store);
  assert(typeof commitHash === 'string', 'Commit hash should be string');
  assert(commitHash.length === 64, 'Commit hash should be 64 characters (SHA-256)');
  
  // Test commit with parent
  const childCommitHash = createCommit(treeHash, 'Second commit', 'Test Author', 'test@example.com', commitHash, store);
  assert(typeof childCommitHash === 'string', 'Child commit hash should be string');
  assert(childCommitHash !== commitHash, 'Child commit should have different hash');
  
  // Test with email parameter
  const emailCommitHash = createCommit(treeHash, 'Commit with email', 'Test Author', 'test@example.com', null, store);
  assert(typeof emailCommitHash === 'string', 'Commit with email should work');
  
  console.log('✅ createCommit tests passed');
}

function testGetCommit() {
  console.log('Testing getCommit...');
  
  cleanupTestDB();
  const store = initStore(TEST_DB);
  
  // Create real blob for entry
  const fileResult = storeBlob(new TextEncoder().encode('file content'), store);
  const entries = [{ name: 'file.txt', type: 'file', hash: fileResult.hash, binary: false, mode: 0o644, mtime: Date.now(), size: 12, target: null }];
  const treeHash = storeTree(entries, store);
  const commitHash = createCommit(treeHash, 'Test commit message', 'John Doe', null, null, store);
  
  const commit = getCommit(commitHash, store);
  
  assert(typeof commit === 'object', 'Commit should be object');
  assert(commit.tree === treeHash, 'Commit should have correct tree hash');
  assert(commit.message === 'Test commit message', 'Commit should have correct message');
  assert(commit.author === 'John Doe', 'Commit should have correct author');
  assert(commit.parent === null, 'Initial commit should have null parent');
  assert(typeof commit.timestamp === 'number', 'Commit should have timestamp');
  assert(commit.timestamp > 0, 'Timestamp should be positive');
  
  // Test commit with parent  
  const childCommitHash = createCommit(treeHash, 'Child commit', 'Jane Doe', 'jane@example.com', commitHash, store);
  const childCommit = getCommit(childCommitHash, store);
  
  assert(childCommit.parent === commitHash, 'Child commit should have correct parent');
  assert(childCommit.author === 'Jane Doe', 'Child commit should have correct author');
  
  console.log('✅ getCommit tests passed');
}

function testGetCommitErrors() {
  console.log('Testing getCommit error handling...');
  
  cleanupTestDB();
  const store = initStore(TEST_DB);
  
  // Test non-existent commit
  const result = getCommit('xxxx', store);
  assert(result === null, 'Should return null for non-existent commit');
  
  console.log('✅ getCommit error handling tests passed');
}

function testCommitExists() {
  console.log('Testing commitExists...');
  
  cleanupTestDB();
  const store = initStore(TEST_DB);
  
  // Create real blob for entry
  const testResult = storeBlob(new TextEncoder().encode('test file content'), store);
  const entries = [{ name: 'test.txt', type: 'file', hash: testResult.hash, binary: false, mode: 0o644, mtime: Date.now(), size: 17, target: null }];
  const treeHash = storeTree(entries, store);
  const commitHash = createCommit(treeHash, 'Test commit', 'Author', null, null, store);
  
  assert(commitExists(commitHash, store) === true, 'Existing commit should exist');
  assert(commitExists('xxxx', store) === false, 'Non-existent commit should not exist');
  
  console.log('✅ commitExists tests passed');
}

function testGetCommitHistory() {
  console.log('Testing getCommitHistory...');
  
  cleanupTestDB();
  const store = initStore(TEST_DB);
  
  // Create a chain of commits - create real blob for entry
  const fileResult = storeBlob(new TextEncoder().encode('file content'), store);
  const entries = [{ name: 'file.txt', type: 'file', hash: fileResult.hash, binary: false, mode: 0o644, mtime: Date.now(), size: 12, target: null }];
  const treeHash = storeTree(entries, store);
  
  const commit1 = createCommit(treeHash, 'First commit', 'Author 1', 'author1@example.com', null, store);
  const commit2 = createCommit(treeHash, 'Second commit', 'Author 2', 'author2@example.com', commit1, store);
  const commit3 = createCommit(treeHash, 'Third commit', 'Author 3', 'author3@example.com', commit2, store);
  
  // Test full history
  const fullHistory = getCommitHistory(commit3, 10, store);
  assert(Array.isArray(fullHistory), 'History should be array');
  assert(fullHistory.length === 3, 'Should have 3 commits');
  
  assert(fullHistory[0].hash === commit3, 'First commit should be latest');
  assert(fullHistory[0].message === 'Third commit', 'First commit should have correct message');
  assert(fullHistory[1].hash === commit2, 'Second commit should be middle');
  assert(fullHistory[2].hash === commit1, 'Third commit should be oldest');
  
  // Test limited history
  const limitedHistory = getCommitHistory(commit3, 2, store);
  assert(limitedHistory.length === 2, 'Limited history should respect maxCount');
  assert(limitedHistory[0].hash === commit3, 'Limited history should start with latest');
  
  // Test single commit history
  const singleHistory = getCommitHistory(commit1, 10, store);
  assert(singleHistory.length === 1, 'Single commit history should have one entry');
  assert(singleHistory[0].hash === commit1, 'Single commit should be correct');
  
  console.log('✅ getCommitHistory tests passed');
}

function testGetTreeFiles() {
  console.log('Testing getTreeFiles...');
  
  cleanupTestDB();
  const store = initStore(TEST_DB);
  
  // Test tree with files only - create real blobs
  const readmeResult2 = storeBlob(new TextEncoder().encode('readme content'), store);
  const imageResult2 = storeBlob(new Uint8Array([0x89, 0x50, 0x4E, 0x47]), store); // PNG header bytes
  
  const fileEntries = [
    { name: 'readme.txt', type: 'file', hash: readmeResult2.hash, binary: false, mode: 0o644, mtime: Date.now(), size: 14, target: null },
    { name: 'image.png', type: 'file', hash: imageResult2.hash, binary: true, mode: 0o644, mtime: Date.now(), size: 4, target: null }
  ];
  
  const fileTreeHash = storeTree(fileEntries, store);
  const files = getTreeFiles(fileTreeHash, '', store);
  
  assert(Array.isArray(files), 'Files should be array');
  assert(files.length === 2, 'Should have 2 files');
  
  // Sort files for comparison (getTreeFiles returns sorted by name)
  files.sort((a, b) => a.name.localeCompare(b.name));

  assert(files[0].name === 'image.png', 'First file should be image.png (sorted alphabetically)');
  assert(files[0].hash === imageResult2.hash, 'First file should have correct hash');

  assert(files[1].name === 'readme.txt', 'Second file should be readme.txt (sorted alphabetically)');
  assert(files[1].hash === readmeResult2.hash, 'Second file should have correct hash');
  
  // Test empty tree
  const emptyTreeHash = storeTree([], store);
  const emptyFiles = getTreeFiles(emptyTreeHash, '', store);
  assert(emptyFiles.length === 0, 'Empty tree should have no files');
  
  console.log('✅ getTreeFiles tests passed');
}

function testCommitChain() {
  console.log('Testing complete commit chain...');
  
  cleanupTestDB();
  const store = initStore(TEST_DB);
  
  // Create initial commit - create real blobs for files
  const file1Result = storeBlob(new TextEncoder().encode('file1 content'), store);
  const entries1 = [
    { name: 'file1.txt', type: 'file', hash: file1Result.hash, binary: false, mode: 0o644, mtime: Date.now(), size: 13, target: null }
  ];
  const tree1 = storeTree(entries1, store);
  const commit1 = createCommit(tree1, 'Add file1', 'Developer', 'dev@example.com', null, store);
  
  // Create second commit with more files
  const file2Result = storeBlob(new TextEncoder().encode('file2 content'), store);
  const entries2 = [
    { name: 'file1.txt', type: 'file', hash: file1Result.hash, binary: false, mode: 0o644, mtime: Date.now(), size: 13, target: null },
    { name: 'file2.txt', type: 'file', hash: file2Result.hash, binary: false, mode: 0o644, mtime: Date.now(), size: 13, target: null }
  ];
  const tree2 = storeTree(entries2, store);
  const commit2 = createCommit(tree2, 'Add file2', 'Developer', 'dev@example.com', commit1, store);
  
  // Verify the chain
  const history = getCommitHistory(commit2, 10, store);
  assert(history.length === 2, 'Should have 2 commits in history');
  assert(history[0].message === 'Add file2', 'Latest commit should be correct');
  assert(history[1].message === 'Add file1', 'First commit should be correct');
  
  // Verify trees
  const retrievedTree1 = getTree(tree1, store);
  const retrievedTree2 = getTree(tree2, store);
  
  assert(retrievedTree1.length === 1, 'First tree should have 1 file');
  assert(retrievedTree2.length === 2, 'Second tree should have 2 files');
  
  console.log('✅ Commit chain tests passed');
}

// Run all tests
function runObjectsTests() {
  console.log('Running Objects Tests...\n');
  
  try {
    testStoreTree();
    testGetTree();
    testGetTreeErrors();
    testCreateCommit();
    testGetCommit();
    testGetCommitErrors();
    testCommitExists();
    testGetCommitHistory();
    testGetTreeFiles();
    testCommitChain();
    
    console.log('\n✅ All objects tests passed!');
    return true;
  } catch (error) {
    console.error(`\n❌ Test failed: ${error.message}`);
    console.error(error.stack);
    return false;
  } finally {
    // Clean up test database
    cleanupTestDB();
  }
}

// Export for use by other test files
module.exports = { runObjectsTests };

// Run tests if called directly
if (require.main === module) {
  process.exit(runObjectsTests() ? 0 : 1);
}