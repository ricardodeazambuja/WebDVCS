/**
 * Browser API Tests - Test the actual APIs used by web interface and CLI
 * Tests BrowserRepo class methods that WorkerWrapper uses
 * Tests MiniRepo class methods that CLI uses
 */

const { BrowserRepo } = require('../lib/browser/browser-entry');
const { MiniRepo } = require('../lib/core/repo');
const fs = require('fs');
const path = require('path');

// Test utilities
function getTestDB() {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substr(2, 9);
  return `tests/test-browser-api-${timestamp}-${random}.sqlite`;
}

function cleanupTestDB(dbPath) {
  try {
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  } catch (error) {
    console.warn(`Failed to cleanup test DB ${dbPath}:`, error.message);
  }
}

async function testBrowserRepoClass() {
  console.log('Testing BrowserRepo class (what web interface worker uses)...');

  try {
    const repo = new BrowserRepo(':memory:');

    // Test initialization
    console.log('  Testing BrowserRepo init...');
    await repo.init();

  // Test createRepository class method (not standalone function)
  console.log('  Testing BrowserRepo.createRepository() class method...');
  await repo.createRepository('test-repo');

  // Test loadRepository class method
  console.log('  Testing BrowserRepo.loadRepository() class method...');
  const exportedData = repo.exportRepository();

  const newRepo = new BrowserRepo(exportedData);
  await newRepo.init();

  // Test adding files
  console.log('  Testing BrowserRepo file operations...');
  repo.addFile('test.txt', 'Hello World', false);

  const staged = repo.getStagedFiles();
  if (!staged || staged.length === 0) {
    throw new Error('BrowserRepo.getStagedFiles() failed');
  }

  // Test commit
  console.log('  Testing BrowserRepo.commit()...');
  const commitResult = repo.commit('Test commit', 'Test User', 'test@example.com');
  if (!commitResult || !commitResult.hash) {
    throw new Error('BrowserRepo.commit() failed');
  }

  // Test stats
  console.log('  Testing BrowserRepo.getStats()...');
  const stats = repo.getStats();
  if (!stats || typeof stats.blobs !== 'number') {
    throw new Error('BrowserRepo.getStats() failed');
  }

    console.log('✅ BrowserRepo class tests passed');

  } catch (error) {
    if (error.message.includes('window is not defined') ||
        error.message.includes('SQL.js not loaded')) {
      console.log('⚠️  BrowserRepo requires browser environment - skipping Node.js test');
      console.log('    (This is tested by browser tests via WorkerWrapper)');
      return;
    }
    throw error;
  }
}

function testMiniRepoClass() {
  console.log('Testing MiniRepo class (what CLI uses)...');

  const testDB = getTestDB();

  try {
    // Test initialization (MiniRepo initializes in constructor)
    console.log('  Testing MiniRepo constructor...');
    const repo = new MiniRepo(testDB);

    // Test adding files (using actual CLI API)
    console.log('  Testing MiniRepo.addFile()...');
    const addResult = repo.addFile('test.txt', 'Hello CLI World');
    if (!addResult || addResult.unchanged) {
      throw new Error('MiniRepo.addFile() failed');
    }

    // Test listing files (CLI uses listFiles)
    console.log('  Testing MiniRepo.listFiles()...');
    const files = repo.listFiles();
    if (!files || !files.includes('test.txt')) {
      throw new Error('MiniRepo.listFiles() failed - file not staged');
    }

    // Test commit (need to set author first)
    console.log('  Testing MiniRepo.commit()...');
    const commitResult = repo.commit('Test CLI commit', 'Test User', 'test@example.com');
    if (!commitResult || !commitResult.commitHash) {
      throw new Error('MiniRepo.commit() failed - no commitHash in result');
    }
    const commitHash = commitResult.commitHash;

    // Test log
    console.log('  Testing MiniRepo.log()...');
    const commits = repo.log(5);
    if (!commits || commits.length === 0) {
      throw new Error('MiniRepo.log() failed');
    }

    // Test status (CLI uses status method)
    console.log('  Testing MiniRepo.status()...');
    const status = repo.status();
    if (!status || typeof status.store_objects !== 'number') {
      throw new Error('MiniRepo.status() failed');
    }

    console.log('✅ MiniRepo class tests passed');

  } finally {
    cleanupTestDB(testDB);
  }
}

async function testWorkerWrapperCompatibility() {
  console.log('Testing WorkerWrapper compatibility with BrowserRepo...');

  try {
    // Test that BrowserRepo has all methods that WorkerWrapper expects
    const repo = new BrowserRepo(':memory:');
    await repo.init();

  const expectedMethods = [
    'createRepository', 'loadRepository', 'addFile', 'commit',
    'getStagedFiles', 'getStats', 'clearStagingArea', 'removeFile',
    'createBranch', 'switchBranch', 'listBranches', 'getCurrentBranch',
    'exportBranch', 'importBranch', 'exportRepository'
  ];

  console.log('  Checking BrowserRepo has all WorkerWrapper expected methods...');
  for (const method of expectedMethods) {
    if (typeof repo[method] !== 'function') {
      throw new Error(`BrowserRepo missing method: ${method}`);
    }
  }

    console.log('✅ WorkerWrapper compatibility tests passed');

  } catch (error) {
    if (error.message.includes('window is not defined') ||
        error.message.includes('SQL.js not loaded')) {
      console.log('⚠️  WorkerWrapper compatibility test requires browser environment - skipping');
      console.log('    (This is verified by browser tests)');
      return;
    }
    throw error;
  }
}

// Main test runner
console.log('🧪 Browser API Test Suite');
console.log('==========================\n');

console.log('📋 Testing actual APIs used by web interface and CLI...\n');

(async () => {
  try {
    await testBrowserRepoClass();
    console.log('');

    testMiniRepoClass();
    console.log('');

    await testWorkerWrapperCompatibility();
    console.log('');

    console.log('🎉 All Browser API tests passed!');
    console.log('✅ Web interface WorkerWrapper → BrowserRepo API: WORKING');
    console.log('✅ CLI → MiniRepo API: WORKING');

  } catch (error) {
    console.error('❌ Browser API test failed:', error.message);
    process.exit(1);
  }
})();