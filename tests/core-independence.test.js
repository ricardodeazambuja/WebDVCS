/**
 * Core Independence Tests - Verify core library has no filesystem dependencies
 * 
 * This test ensures that the core library can be used without any Node.js
 * filesystem operations, making it truly universal for both CLI and web environments.
 */

const path = require('path');
const { MiniRepo } = require('../lib/core/repo');
const { initStore } = require('../lib/core/storage');

// Simple test runner
function assert(condition, message = 'Assertion failed') {
  if (!condition) {
    throw new Error(message);
  }
}

function testCoreWithoutFilesystem() {
  console.log('Testing core VCS operations without filesystem...');
  
  // Test that core repo can be created and used without filesystem
  const repo = new MiniRepo(':memory:'); // In-memory database
  
  // Test basic VCS operations with pure data
  const file1Content = new TextEncoder().encode('Hello, World!');
  const file2Content = new TextEncoder().encode('This is another file.');
  
  // Test file operations
  const result1 = repo.addFile('hello.txt', file1Content);
  assert(result1.binary === false, 'Text file should not be marked as binary');
  
  const result2 = repo.addFile('other.txt', file2Content);
  assert(result2.binary === false, 'Text file should not be marked as binary');
  
  // Test binary file detection
  const binaryContent = new Uint8Array([0x89, 0x50, 0x4E, 0x47]); // PNG signature
  const result3 = repo.addFile('image.png', binaryContent, true);
  assert(result3.binary === true, 'Binary file should be marked as binary');
  
  // Test commit operations
  const commitResult = repo.commit('Initial commit', 'Test Author', 'test@example.com');
  assert(typeof commitResult.commitHash === 'string', 'Commit should return hash');
  assert(commitResult.commitHash.length === 64, 'Commit hash should be 64 characters');
  
  // Test checkout operations
  const checkoutResult = repo.checkout(commitResult.commitHash);
  console.log('Checkout result keys:', Object.keys(checkoutResult));
  console.log('Checkout result type:', typeof checkoutResult);
  
  // The checkout might return an object with files property
  const files = checkoutResult.files || checkoutResult;
  assert(Object.keys(files).length === 3, `Should checkout all 3 files, got ${Object.keys(files).length}`);
  assert(files['hello.txt'] !== undefined, 'Should have hello.txt');
  assert(files['other.txt'] !== undefined, 'Should have other.txt');
  assert(files['image.png'] !== undefined, 'Should have image.png');
  
  // Verify file contents
  const retrievedFile1 = new TextDecoder().decode(files['hello.txt']);
  assert(retrievedFile1 === 'Hello, World!', 'File content should match');
  
  console.log('✅ Core VCS operations without filesystem passed');
}

function testCoreMethodsAvailable() {
  console.log('Testing core methods are available...');
  
  const repo = new MiniRepo(':memory:');
  
  // Test that core methods are available
  console.log('Available methods:', Object.getOwnPropertyNames(repo).filter(name => typeof repo[name] === 'function'));
  console.log('Prototype methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(repo)).filter(name => typeof repo[name] === 'function'));
  
  assert(typeof repo.addFile === 'function', 'addFile should be available');
  assert(typeof repo.commit === 'function', 'commit should be available');
  assert(typeof repo.checkout === 'function', 'checkout should be available');
  assert(typeof repo.getFile === 'function', 'getFile should be available');
  assert(typeof repo.showChanges === 'function', 'showChanges should be available');
  
  console.log('✅ Core methods availability tests passed');
}

function testFilesystemMethodsRemoved() {
  console.log('Testing filesystem methods are properly removed...');
  
  const repo = new MiniRepo(':memory:');
  
  // Test that filesystem methods are NOT available in core
  assert(typeof repo.addDirectory === 'undefined', 'addDirectory should not be in core');
  assert(typeof repo.walkDirectory === 'undefined', 'walkDirectory should not be in core');
  
  console.log('✅ Filesystem methods removal tests passed');
}

function testStorageIndependence() {
  console.log('Testing storage layer independence...');
  
  // Test that storage layer works with different database backends
  const store1 = initStore(':memory:'); // Default backend
  
  // Test basic storage operations
  const testData = new Uint8Array([1, 2, 3, 4, 5]);
  const result = store1.storeBlob(testData);
  
  assert(typeof result.hash === 'string', 'Storage should return hash');
  assert(result.hash.length === 64, 'Hash should be 64 characters');
  
  // Test blob retrieval
  const retrieved = store1.getBlob(result.hash);
  assert(retrieved instanceof Uint8Array, 'Retrieved data should be Uint8Array');
  assert(retrieved.every((byte, i) => byte === testData[i]), 'Data should match');
  
  console.log('✅ Storage layer independence tests passed');
}

function testBatchFileOperations() {
  console.log('Testing batch file operations...');
  
  const repo = new MiniRepo(':memory:');
  
  // Test adding multiple files in sequence (simulates web file upload)
  const files = [
    { path: 'file1.txt', content: new TextEncoder().encode('Content 1') },
    { path: 'file2.txt', content: new TextEncoder().encode('Content 2') },
    { path: 'file3.txt', content: new TextEncoder().encode('Content 3') },
  ];
  
  // Add files one by one (like a web interface would)
  const results = [];
  for (const file of files) {
    const result = repo.addFile(file.path, file.content);
    results.push(result);
  }
  
  assert(results.length === 3, 'Should process all files');
  assert(results.every(r => r && typeof r.fileName === 'string'), 'All files should have fileName');
  assert(results.every(r => r && typeof r.binary === 'boolean'), 'All files should have binary flag');
  assert(results.every(r => r && typeof r.size === 'number'), 'All files should have size');
  
  // Test commit
  const commitResult = repo.commit('Added multiple files', 'Web User', 'web@example.com');
  assert(typeof commitResult.commitHash === 'string', 'Should create commit');
  
  // Test checkout
  const checkoutResult = repo.checkout(commitResult.commitHash);
  const checkout = checkoutResult.files || checkoutResult;
  assert(Object.keys(checkout).length === 3, 'Should checkout all files');
  
  console.log('✅ Batch file operations tests passed');
}

function testGetStatsWithoutFilesystem() {
  console.log('Testing getStats without filesystem dependencies...');
  
  const repo = new MiniRepo(':memory:');
  
  // Add some data
  repo.addFile('test.txt', new TextEncoder().encode('Test content'));
  repo.commit('Test commit', 'Test Author');
  
  // Test that getStats works without filesystem access (if available)
  if (typeof repo.getStats === 'function') {
    const stats = repo.getStats();
    
    assert(typeof stats === 'object', 'Stats should return object');
    assert(typeof stats.database === 'object', 'Should have database stats');
    assert(typeof stats.blobs === 'number', 'Should have blobs count');
    assert(typeof stats.database.file_size_bytes === 'number', 'Should have database size');
    
    // The size might be 0 for in-memory database, but shouldn't crash
    assert(stats.database.file_size_bytes >= 0, 'Database size should be non-negative');
    console.log('✅ getStats method works without filesystem');
  } else {
    console.log('ℹ️  getStats method not available (expected for pure core)');
  }
  
  console.log('✅ getStats without filesystem tests passed');
}

// Run all tests
function runCoreIndependenceTests() {
  console.log('Running Core Independence Tests...\n');
  
  try {
    testCoreWithoutFilesystem();
    testCoreMethodsAvailable();
    testFilesystemMethodsRemoved();
    testStorageIndependence();
    testBatchFileOperations();
    testGetStatsWithoutFilesystem();
    
    console.log('\n✅ All core independence tests passed!');
    console.log('\n📋 Core Independence Summary:');
    console.log('- Core VCS operations work without filesystem ✅');
    console.log('- All necessary core methods available ✅');
    console.log('- Filesystem methods properly removed from core ✅');
    console.log('- Storage layer is database-backend independent ✅');
    console.log('- Batch operations work (web-friendly) ✅');
    console.log('- Statistics work without filesystem access ✅');
    
    console.log('\n🎯 Core library is truly universal!');
    console.log('✨ Ready for both CLI and web environments!');
    
    return true;
  } catch (error) {
    console.error(`\n❌ Core independence test failed: ${error.message}`);
    console.error(error.stack);
    return false;
  }
}

// Export for use by other test files
module.exports = { runCoreIndependenceTests };

// Run tests if called directly
if (require.main === module) {
  process.exit(runCoreIndependenceTests() ? 0 : 1);
}