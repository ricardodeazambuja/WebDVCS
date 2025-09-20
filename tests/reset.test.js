/**
 * Reset Tests - Real tests for reset command functionality
 */

const fs = require('fs');
const path = require('path');
const { MiniRepo } = require('../webdvcs-cli'); // CLI-enhanced version with filesystem methods

// Simple test runner
function assert(condition, message = 'Assertion failed') {
  if (!condition) {
    throw new Error(message);
  }
}

// Assert throws for testing error cases
function assertThrows(fn, message = 'Expected function to throw') {
  try {
    fn();
    throw new Error(message);
  } catch (error) {
    if (error.message === message) {
      throw error; // Re-throw our assertion error
    }
    // Expected error occurred - test passes
  }
}

// Generate unique test database paths to avoid conflicts
let testCounter = 0;
function getTestDB() {
  return path.join(__dirname, `test-reset-${++testCounter}.sqlite`);
}

function cleanupTestDB(dbPath) {
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
  }
}

function createTestRepo() {
  const testDB = getTestDB();
  const repo = new MiniRepo(testDB);
  repo.setAuthor('Test User', 'test@example.com');
  return { repo, testDB };
}

function testSoftReset() {
  console.log('Testing soft reset...');
  
  const { repo, testDB } = createTestRepo();
  
  // Test --soft: move HEAD, keep staging area
  repo.addFile('file1.txt', 'Content 1');
  const commit1 = repo.commit('First commit');
  
  repo.addFile('file2.txt', 'Content 2');
  const commit2 = repo.commit('Second commit');
  
  // Stage some changes
  repo.addFile('file3.txt', 'Content 3');
  
  // Soft reset to first commit
  const resetResult = repo.reset(commit1.commitHash, { mode: 'soft' });
  
  assert(resetResult.success === true, 'Reset should succeed');
  assert(repo.getCurrentHead() === commit1.commitHash, 'HEAD should move to commit1');
  
  // Staging area should be preserved
  assert(repo.getFile('file3.txt') !== null, 'Staged files should remain');
  
  // Repository should only have commit1 files
  const repoFilesList = repo.listRepoFiles();
  const fileNames = repoFilesList.files.map(f => f.name);
  assert(repoFilesList.files.length === 1, 'Repo should have 1 file');
  assert(fileNames[0] === 'file1.txt', 'Should have file from commit1');
  
  cleanupTestDB(testDB);
  console.log('✅ Soft reset test passed');
}

function testHardReset() {
  console.log('Testing hard reset...');
  
  const { repo, testDB } = createTestRepo();
  
  // Test --hard: move HEAD, clear staging area
  repo.addFile('file1.txt', 'Content 1');
  const commit1 = repo.commit('First commit');
  
  repo.addFile('file2.txt', 'Content 2');
  const commit2 = repo.commit('Second commit');
  
  // Stage some changes
  repo.addFile('file3.txt', 'Content 3');
  repo.addFile('file1.txt', 'Modified content');
  
  // Hard reset to first commit
  const resetResult = repo.reset(commit1.commitHash, { mode: 'hard' });
  
  assert(resetResult.success === true, 'Reset should succeed');
  assert(repo.getCurrentHead() === commit1.commitHash, 'HEAD should move to commit1');
  
  // Staging area should be cleared, current commit should be set
  const stagedFiles = repo.listFiles();
  assert(stagedFiles.length === 1, 'Should have 1 file from current commit');
  assert(stagedFiles[0] === 'file1.txt', 'Should have file1.txt');
  
  // Verify staging area is actually empty
  assert(repo.stagingArea.size === 0, 'Staging area should be empty after hard reset');
  
  // Files should be available through current commit
  const file1Content = new TextDecoder().decode(repo.getFile('file1.txt'));
  assert(file1Content === 'Content 1', 'File should be restored to original content');
  
  // File3 should not be accessible after hard reset (throws error instead of null)
  try {
    repo.getFile('file3.txt');
    assert(false, 'file3.txt should not be accessible after hard reset');
  } catch (error) {
    assert(error.message.includes('File not staged'), 'Should get proper error for non-existent file');
  }
  
  cleanupTestDB(testDB);
  console.log('✅ Hard reset test passed');
}

function testResetRelativeCommit() {
  console.log('Testing reset to relative commit...');
  
  const { repo, testDB } = createTestRepo();
  
  // Test reset to HEAD~1, HEAD~2, etc.
  repo.addFile('file1.txt', 'v1');
  const commit1 = repo.commit('Commit 1');
  
  repo.addFile('file2.txt', 'v2');  
  const commit2 = repo.commit('Commit 2');
  
  repo.addFile('file3.txt', 'v3');
  const commit3 = repo.commit('Commit 3');
  
  // Reset to HEAD~1 (commit2)
  const resetResult = repo.reset('HEAD~1', { mode: 'hard' });
  assert(repo.getCurrentHead() === commit2.commitHash, 'Should reset to commit2');
  
  const filesList = repo.listRepoFiles();
  assert(filesList.files.length === 2, 'Should have 2 files after reset');
  
  cleanupTestDB(testDB);
  console.log('✅ Reset relative commit test passed');
}

function testResetToCurrentCommit() {
  console.log('Testing reset to current commit...');
  
  const { repo, testDB } = createTestRepo();
  
  // Test reset to current commit (should be no-op)
  repo.addFile('test.txt', 'content');
  const commit1 = repo.commit('Test commit');
  const originalHead = repo.getCurrentHead();
  
  const resetResult = repo.reset(commit1.commitHash, { mode: 'soft' });
  
  assert(resetResult.success === true, 'Reset should succeed');
  assert(repo.getCurrentHead() === originalHead, 'HEAD should not change');
  
  cleanupTestDB(testDB);
  console.log('✅ Reset to current commit test passed');
}

function testResetToNonExistentCommit() {
  console.log('Testing reset to non-existent commit...');
  
  const { repo, testDB } = createTestRepo();
  
  repo.addFile('test.txt', 'content');
  repo.commit('Test');
  
  assertThrows(() => repo.reset('invalidhash123'), 'Should throw for invalid commit');
  
  cleanupTestDB(testDB);
  console.log('✅ Reset to non-existent commit test passed');
}

function testResetEmptyRepo() {
  console.log('Testing reset on empty repo...');
  
  const { repo, testDB } = createTestRepo();
  
  assertThrows(() => repo.reset('HEAD~1'), 'Should throw when no commits exist');
  
  cleanupTestDB(testDB);
  console.log('✅ Reset empty repo test passed');
}

function testResetBranchHeadUpdate() {
  console.log('Testing reset branch head update...');
  
  const { repo, testDB } = createTestRepo();
  
  // Verify branch HEAD is properly updated
  repo.addFile('file.txt', 'v1');
  const commit1 = repo.commit('Commit 1');
  
  repo.addFile('file.txt', 'v2');
  const commit2 = repo.commit('Commit 2');
  
  // Create feature branch pointing to commit2
  repo.createBranch('feature');
  repo.switchBranch('feature');
  
  // Reset feature branch to commit1
  repo.reset(commit1.commitHash, { mode: 'hard' });
  
  // Verify branch head updated
  const branchRef = repo.store.getRef('refs/heads/feature');
  assert(branchRef.hash === commit1.commitHash, 'Branch HEAD should be updated');

  // Verify main branch unchanged
  repo.switchBranch('main');
  const mainRef = repo.store.getRef('refs/heads/main');
  assert(mainRef.hash === commit2.commitHash, 'Main branch should be unchanged');
  
  cleanupTestDB(testDB);
  console.log('✅ Reset branch head update test passed');
}

function testResetPreservesOtherBranches() {
  console.log('Testing reset preserves other branches...');
  
  const { repo, testDB } = createTestRepo();
  
  // Create commits on main
  repo.addFile('main.txt', 'main content');
  const mainCommit1 = repo.commit('Main commit 1');
  
  repo.addFile('main2.txt', 'main content 2');
  const mainCommit2 = repo.commit('Main commit 2');
  
  // Create feature branch
  repo.createBranch('feature', mainCommit1.commitHash);
  repo.switchBranch('feature');
  
  repo.addFile('feature.txt', 'feature content');
  const featureCommit = repo.commit('Feature commit');
  
  // Reset main branch
  repo.switchBranch('main');
  repo.reset(mainCommit1.commitHash, { mode: 'hard' });
  
  // Verify main branch reset
  assert(repo.getCurrentHead() === mainCommit1.commitHash, 'Main should be reset');
  
  // Verify feature branch unchanged
  repo.switchBranch('feature');
  assert(repo.getCurrentHead() === featureCommit.commitHash, 'Feature branch should be unchanged');
  
  cleanupTestDB(testDB);
  console.log('✅ Reset preserves other branches test passed');
}

function testResetInvalidMode() {
  console.log('Testing reset with invalid mode...');
  
  const { repo, testDB } = createTestRepo();
  
  repo.addFile('test.txt', 'content');
  const commit1 = repo.commit('Test commit');
  
  assertThrows(() => repo.reset(commit1.commitHash, { mode: 'invalid' }), 'Should throw for invalid mode');
  
  cleanupTestDB(testDB);
  console.log('✅ Reset invalid mode test passed');
}

// Run all tests
function runResetTests() {
  console.log('Running Reset Tests...\n');
  
  try {
    testSoftReset();
    testHardReset();
    testResetRelativeCommit();
    testResetToCurrentCommit();
    testResetToNonExistentCommit();
    testResetEmptyRepo();
    testResetBranchHeadUpdate();
    testResetPreservesOtherBranches();
    testResetInvalidMode();
    
    console.log('\n✅ All reset tests passed!');
    return true;
  } catch (error) {
    console.error(`\n❌ Test failed: ${error.message}`);
    console.error(error.stack);
    return false;
  } finally {
    // Clean up test database files
    for (let i = 1; i <= testCounter; i++) {
      const testDb = path.join(__dirname, `test-reset-${i}.sqlite`);
      cleanupTestDB(testDb);
    }
  }
}

// Export for use by other test files
module.exports = { runResetTests };

// Run tests if called directly
if (require.main === module) {
  process.exit(runResetTests() ? 0 : 1);
}