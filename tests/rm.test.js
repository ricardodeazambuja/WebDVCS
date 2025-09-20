/**
 * Rm Tests - Real tests for rm command functionality
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

// Generate unique test database paths to avoid conflicts
let testCounter = 0;
function getTestDB() {
  return path.join(__dirname, `test-rm-${++testCounter}.sqlite`);
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

function testRemoveSingleFile() {
  console.log('Testing remove single file...');
  
  const { repo, testDB } = createTestRepo();
  
  // Setup: Create repo, add file, commit it
  repo.addFile('test.txt', 'Hello World');
  const commit1 = repo.commit('Add test file');
  
  // Test: Remove file from staging area (current unstage behavior)
  repo.addFile('test.txt', 'Modified content');  // Stage modified version
  const removed = repo.removeFile('test.txt');  // This is current unstage
  assert(removed === true, 'removeFile should succeed for staged file');
  
  // NEW: Test rm command (removes from next commit)
  repo.addFile('test.txt', 'Modified content');
  const rmResult = repo.rm('test.txt');
  assert(rmResult === true, 'File removal should succeed');
  
  // Verify file not in staging area
  try {
    repo.getFile('test.txt');
    assert(false, 'Should throw error for removed file');
  } catch (error) {
    assert(error.message.includes('File not staged'), 'Should get proper error message');
  }
  
  // Commit and verify file not in new commit tree
  const commit2 = repo.commit('Remove test file');
  const filesList = repo.listRepoFiles();
  const fileNames = filesList.files.map(f => f.name);
  assert(!fileNames.includes('test.txt'), 'File should not exist in new commit');
  
  // Verify file still exists in previous commit
  repo.checkout(commit1.commitHash);
  const fileInOldCommit = repo.getFile('test.txt');
  assert(fileInOldCommit !== null, 'File should still exist in old commit');
  
  cleanupTestDB(testDB);
  console.log('✅ Remove single file test passed');
}

function testRemoveNonExistentFile() {
  console.log('Testing remove non-existent file...');
  
  const { repo, testDB } = createTestRepo();
  
  // Test graceful handling of non-existent files
  const result = repo.rm('nonexistent.txt');
  assert(result === false, 'Should return false for non-existent file');
  // Should not throw error
  
  cleanupTestDB(testDB);
  console.log('✅ Remove non-existent file test passed');
}

function testRemoveMultipleFiles() {
  console.log('Testing remove multiple files...');
  
  const { repo, testDB } = createTestRepo();
  
  // Test removing multiple files at once
  repo.addFile('file1.txt', 'Content 1');
  repo.addFile('file2.txt', 'Content 2');
  repo.addFile('file3.txt', 'Content 3');
  repo.commit('Add files');
  
  // Stage and remove multiple
  repo.addFile('file1.txt', 'Modified 1');
  repo.addFile('file2.txt', 'Modified 2');
  
  const result = repo.rm(['file1.txt', 'file2.txt']);
  assert(result.removed === 2, 'Should remove 2 files');
  assert(repo.getFile('file3.txt') !== null, 'File3 should be accessible from current commit');
  
  // Verify file3.txt is not in staging area (but is accessible from commit)
  assert(!repo.stagingArea.has('file3.txt'), 'File3 should not be in staging area');
  
  // Verify file3 still exists in HEAD
  const headFiles = repo.getHeadFileMetadata();
  assert(headFiles.has('file3.txt'), 'File3 should still exist in HEAD');
  
  cleanupTestDB(testDB);
  console.log('✅ Remove multiple files test passed');
}

function testRemoveThenCommit() {
  console.log('Testing remove then commit workflow...');
  
  const { repo, testDB } = createTestRepo();
  
  // Verify complete rm → commit workflow
  repo.addFile('temp.txt', 'Temporary file');
  const commit1 = repo.commit('Add temp file');
  
  repo.rm('temp.txt');
  const commit2 = repo.commit('Remove temp file');
  
  // New commit should not have the file
  const currentFilesList = repo.listRepoFiles();
  assert(currentFilesList.files.length === 0, 'Current commit should have no files');
  
  // Old commit should still have it - check by getting file directly
  repo.checkout(commit1.commitHash);
  const fileInOldCommit = repo.getFile('temp.txt');
  assert(fileInOldCommit !== null, 'Old commit should still have file');
  
  cleanupTestDB(testDB);
  console.log('✅ Remove then commit test passed');
}

function testRemoveFromEmptyRepo() {
  console.log('Testing remove from empty repo...');
  
  const { repo, testDB } = createTestRepo();
  
  const result = repo.rm('anything.txt');
  assert(result === false, 'Cannot remove from empty repo');
  
  cleanupTestDB(testDB);
  console.log('✅ Remove from empty repo test passed');
}

function testRemoveAlreadyRemovedFile() {
  console.log('Testing remove already removed file...');
  
  const { repo, testDB } = createTestRepo();
  
  repo.addFile('test.txt', 'content');
  repo.commit('Add file');
  
  repo.rm('test.txt');
  const result2 = repo.rm('test.txt');  // Remove again
  assert(result2 === false, 'Cannot remove already removed file');
  
  cleanupTestDB(testDB);
  console.log('✅ Remove already removed file test passed');
}

function testRemoveOnlyStagedFile() {
  console.log('Testing remove file that exists only in staging area...');
  
  const { repo, testDB } = createTestRepo();
  
  // Add file to staging but don't commit
  repo.addFile('staged-only.txt', 'Only staged content');
  
  // Try to remove it
  const result = repo.rm('staged-only.txt');
  assert(result === true, 'Should be able to remove staged-only file');
  
  // Verify it's removed from staging
  try {
    repo.getFile('staged-only.txt');
    assert(false, 'Should throw error for removed file');
  } catch (error) {
    assert(error.message.includes('File not staged'), 'Should get proper error message');
  }
  
  cleanupTestDB(testDB);
  console.log('✅ Remove staged-only file test passed');
}

function testRemovePreservesOtherFiles() {
  console.log('Testing remove preserves other files...');
  
  const { repo, testDB } = createTestRepo();
  
  // Add multiple files
  repo.addFile('keep1.txt', 'Keep this');
  repo.addFile('remove.txt', 'Remove this');
  repo.addFile('keep2.txt', 'Keep this too');
  repo.commit('Add files');
  
  // Remove one file
  repo.rm('remove.txt');
  repo.commit('Remove one file');
  
  // Verify other files still exist
  const filesList = repo.listRepoFiles();
  const fileNames = filesList.files.map(f => f.name);
  assert(filesList.files.length === 2, 'Should have 2 remaining files');
  assert(fileNames.includes('keep1.txt'), 'Should keep keep1.txt');
  assert(fileNames.includes('keep2.txt'), 'Should keep keep2.txt');
  assert(!fileNames.includes('remove.txt'), 'Should not have remove.txt');
  
  cleanupTestDB(testDB);
  console.log('✅ Remove preserves other files test passed');
}

function testRmStagingBehavior() {
  console.log('Testing rm staging behavior (Git-like)...');
  
  const { repo, testDB } = createTestRepo();
  
  // Setup: Create files and commit them
  repo.addFile('file1.txt', 'Content 1');
  repo.addFile('file2.txt', 'Content 2');
  repo.commit('Initial commit');
  
  // Test: Remove file1.txt using rm
  const rmResult = repo.rm('file1.txt');
  assert(rmResult === true, 'rm should succeed for committed file');
  
  // Check status shows file staged for deletion
  const status = repo.status();
  assert(Array.isArray(status.deleted), 'status.deleted should be an array');
  assert(status.deleted.includes('file1.txt'), 'file1.txt should be staged for deletion');
  assert(status.deleted.length === 1, 'Should have exactly 1 file staged for deletion');
  
  // Test: unstage the removal
  const unstageResult = repo.unstage('file1.txt');
  assert(unstageResult.action === 'unremoved', 'Should successfully cancel file removal');
  assert(unstageResult.file === 'file1.txt', 'Should return correct file name');
  
  // Check status after unstaging
  const statusAfterUnstage = repo.status();
  assert(statusAfterUnstage.deleted.length === 0, 'Should have no files staged for deletion after unstage');
  
  // Test: Remove staged file (not just committed file)
  repo.addFile('new_file.txt', 'New content');  // Stage new file
  const stagedFiles = repo.status().staged;
  assert(stagedFiles.includes('new_file.txt'), 'new_file.txt should be staged');
  
  repo.rm('new_file.txt');  // Remove staged file
  const statusAfterRmStaged = repo.status();
  assert(!statusAfterRmStaged.staged.includes('new_file.txt'), 'new_file.txt should not be in staging');
  assert(statusAfterRmStaged.deleted.includes('new_file.txt'), 'new_file.txt should be marked for deletion');
  
  // Test: unstage removal of staged file
  const unstageStaged = repo.unstage('new_file.txt');
  assert(unstageStaged.action === 'unremoved', 'Should cancel removal of staged file');
  
  const finalStatus = repo.status();
  assert(!finalStatus.deleted.includes('new_file.txt'), 'new_file.txt should not be marked for deletion');
  assert(finalStatus.deleted.length === 0, 'Should have no files marked for deletion');
  
  // Test: Try to unstage non-existent file
  const unstageNonExistent = repo.unstage('non_existent.txt');
  assert(unstageNonExistent.action === 'not_found', 'Should return not_found for non-existent file');
  
  cleanupTestDB(testDB);
  console.log('✅ Rm staging behavior test passed');
}

// Run all tests
function runRmTests() {
  console.log('Running Rm Tests...\n');
  
  try {
    testRemoveSingleFile();
    testRemoveNonExistentFile();
    testRemoveMultipleFiles();
    testRemoveThenCommit();
    testRemoveFromEmptyRepo();
    testRemoveAlreadyRemovedFile();
    testRemoveOnlyStagedFile();
    testRemovePreservesOtherFiles();
    testRmStagingBehavior();
    
    console.log('\n✅ All rm tests passed!');
    return true;
  } catch (error) {
    console.error(`\n❌ Test failed: ${error.message}`);
    console.error(error.stack);
    return false;
  } finally {
    // Clean up test database files
    for (let i = 1; i <= testCounter; i++) {
      const testDb = path.join(__dirname, `test-rm-${i}.sqlite`);
      cleanupTestDB(testDb);
    }
  }
}

// Export for use by other test files
module.exports = { runRmTests };

// Run tests if called directly
if (require.main === module) {
  process.exit(runRmTests() ? 0 : 1);
}