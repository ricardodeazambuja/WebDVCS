/**
 * Merge Tests - Real tests for merge command functionality
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
  return path.join(__dirname, `test-merge-${++testCounter}.sqlite`);
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

function testFastForwardMerge() {
  console.log('Testing fast-forward merge...');
  
  const { repo, testDB } = createTestRepo();
  
  // Test simplest case: target branch is directly ahead
  // Main branch: commit A
  repo.addFile('main.txt', 'Main content');
  const commitA = repo.commit('Initial commit');
  
  // Feature branch: commit A → B
  repo.createBranch('feature');
  repo.switchBranch('feature');
  repo.addFile('feature.txt', 'Feature content');
  const commitB = repo.commit('Add feature');
  
  // Switch back to main and merge
  repo.switchBranch('main');
  const mergeResult = repo.merge('feature');
  
  assert(mergeResult.type === 'fast-forward', 'Should be fast-forward merge');
  assert(repo.getCurrentHead() === commitB.commitHash, 'Main HEAD should advance to feature commit');
  
  // Verify files from both branches exist
  const filesList = repo.listRepoFiles();
  const files = filesList.files.map(f => f.name);
  assert(files.includes('main.txt'), 'Should have main file');
  assert(files.includes('feature.txt'), 'Should have feature file');
  
  cleanupTestDB(testDB);
  console.log('✅ Fast-forward merge test passed');
}

function testThreeWayMerge() {
  console.log('Testing three-way merge...');
  
  const { repo, testDB } = createTestRepo();
  
  // Test merge when branches have diverged
  // Common ancestor: commit A
  repo.addFile('common.txt', 'Common content');
  const commitA = repo.commit('Common ancestor');
  
  // Main branch: A → B
  repo.addFile('main.txt', 'Main specific');
  const commitB = repo.commit('Main changes');
  
  // Feature branch: A → C  
  repo.createBranch('feature', commitA.commitHash);
  repo.switchBranch('feature');
  repo.addFile('feature.txt', 'Feature specific');
  const commitC = repo.commit('Feature changes');
  
  // Merge feature into main
  repo.switchBranch('main');
  const mergeResult = repo.merge('feature');
  
  assert(mergeResult.type === 'three-way', 'Should be three-way merge');
  assert(mergeResult.conflicts.length === 0, 'Should have no conflicts');
  
  // Verify all files present
  const filesList = repo.listRepoFiles();
  const files = filesList.files.map(f => f.name);
  assert(files.length === 3, 'Should have all 3 files');
  assert(files.includes('common.txt'), 'Should have common file');
  assert(files.includes('main.txt'), 'Should have main file');
  assert(files.includes('feature.txt'), 'Should have feature file');
  
  cleanupTestDB(testDB);
  console.log('✅ Three-way merge test passed');
}

function testMergeWithConflicts() {
  console.log('Testing merge with conflicts...');
  
  const { repo, testDB } = createTestRepo();
  
  // Test conflict detection
  // Common base
  repo.addFile('conflict.txt', 'Original content');
  const base = repo.commit('Base');
  
  // Main branch modifies file
  repo.addFile('conflict.txt', 'Main modification');
  repo.commit('Main changes');
  
  // Feature branch modifies same file differently
  repo.createBranch('feature', base.commitHash);
  repo.switchBranch('feature');
  repo.addFile('conflict.txt', 'Feature modification');
  repo.commit('Feature changes');
  
  // Attempt merge
  repo.switchBranch('main');
  const mergeResult = repo.merge('feature');
  
  assert(mergeResult.type === 'conflict', 'Should detect conflict');
  assert(mergeResult.conflicts.length === 1, 'Should have 1 conflict');
  assert(mergeResult.conflicts[0].file === 'conflict.txt', 'Should identify conflicting file');
  
  cleanupTestDB(testDB);
  console.log('✅ Merge with conflicts test passed');
}

function testMergeUpToDate() {
  console.log('Testing merge when up to date...');
  
  const { repo, testDB } = createTestRepo();
  
  // Test merge when already up to date
  repo.addFile('test.txt', 'content');
  repo.commit('Initial');
  
  repo.createBranch('feature');
  // No changes on feature branch
  
  const mergeResult = repo.merge('feature');
  assert(mergeResult.type === 'up-to-date', 'Should be already up to date');
  
  cleanupTestDB(testDB);
  console.log('✅ Merge up-to-date test passed');
}

function testMergeNonExistentBranch() {
  console.log('Testing merge non-existent branch...');
  
  const { repo, testDB } = createTestRepo();
  
  repo.addFile('test.txt', 'content');
  repo.commit('Initial');
  
  assertThrows(() => repo.merge('nonexistent'), 'Should throw for non-existent branch');
  
  cleanupTestDB(testDB);
  console.log('✅ Merge non-existent branch test passed');
}

function testMergeSameBranch() {
  console.log('Testing merge same branch...');
  
  const { repo, testDB } = createTestRepo();
  
  repo.addFile('test.txt', 'content');
  repo.commit('Initial');
  
  const result = repo.merge('main');  // Merge main into main
  assert(result.type === 'up-to-date', 'Merging same branch should be no-op');
  
  cleanupTestDB(testDB);
  console.log('✅ Merge same branch test passed');
}

function testMergeEmptyBranch() {
  console.log('Testing merge from empty branch...');
  
  const { repo, testDB } = createTestRepo();
  
  // Create content on main
  repo.addFile('main.txt', 'main content');
  repo.commit('Main commit');
  
  // Create empty feature branch
  repo.createBranch('feature');
  // Don't switch or add anything to feature
  
  const mergeResult = repo.merge('feature');
  assert(mergeResult.type === 'up-to-date', 'Should be up-to-date when merging empty branch');
  
  cleanupTestDB(testDB);
  console.log('✅ Merge empty branch test passed');
}

function testMergeIntoEmptyBranch() {
  console.log('Testing merge into empty branch...');

  const { repo, testDB } = createTestRepo();

  // Create initial commit to allow branching
  repo.addFile('initial.txt', 'initial content');
  const initialCommit = repo.commit('Initial commit');

  // Create content on feature branch
  repo.createBranch('feature');
  repo.switchBranch('feature');
  repo.addFile('feature.txt', 'feature content');
  const featureCommit = repo.commit('Feature commit');

  // Switch to main (now has initial commit) and merge feature
  repo.switchBranch('main');
  const mergeResult = repo.merge('feature');

  assert(mergeResult.type === 'fast-forward', 'Should be fast-forward merge since main hasnt changed');
  // No conflicts property for fast-forward merge

  // Verify both files exist after merge
  const filesList = repo.listRepoFiles();
  const files = filesList.files.map(f => f.name);
  assert(files.includes('initial.txt'), 'Should have initial file');
  assert(files.includes('feature.txt'), 'Should have feature file');

  cleanupTestDB(testDB);
  console.log('✅ Merge into empty branch test passed');
}

function testMergeWithFileAdditions() {
  console.log('Testing merge with file additions...');
  
  const { repo, testDB } = createTestRepo();
  
  // Common base
  repo.addFile('base.txt', 'base content');
  const base = repo.commit('Base commit');
  
  // Main branch adds file1
  repo.addFile('file1.txt', 'file1 content');
  repo.commit('Add file1');
  
  // Feature branch adds file2
  repo.createBranch('feature', base.commitHash);
  repo.switchBranch('feature');
  repo.addFile('file2.txt', 'file2 content');
  repo.commit('Add file2');
  
  // Merge feature into main
  repo.switchBranch('main');
  const mergeResult = repo.merge('feature');
  
  assert(mergeResult.type === 'three-way', 'Should be three-way merge');
  assert(mergeResult.conflicts.length === 0, 'Should have no conflicts');
  
  // Verify all files present
  const filesList = repo.listRepoFiles();
  const files = filesList.files.map(f => f.name);
  assert(files.length === 3, 'Should have all 3 files');
  assert(files.includes('base.txt'), 'Should have base file');
  assert(files.includes('file1.txt'), 'Should have file1');
  assert(files.includes('file2.txt'), 'Should have file2');
  
  cleanupTestDB(testDB);
  console.log('✅ Merge with file additions test passed');
}

function testMergeWithSameAdditions() {
  console.log('Testing merge with same file added in both branches...');
  
  const { repo, testDB } = createTestRepo();
  
  // Common base
  repo.addFile('base.txt', 'base content');
  const base = repo.commit('Base commit');
  
  // Main branch adds same file
  repo.addFile('same.txt', 'same content');
  repo.commit('Add same file on main');
  
  // Feature branch adds same file with same content
  repo.createBranch('feature', base.commitHash);
  repo.switchBranch('feature');
  repo.addFile('same.txt', 'same content');
  repo.commit('Add same file on feature');
  
  // Merge feature into main
  repo.switchBranch('main');
  const mergeResult = repo.merge('feature');
  
  assert(mergeResult.type === 'three-way', 'Should be three-way merge');
  assert(mergeResult.conflicts.length === 0, 'Should have no conflicts for identical additions');
  
  // Verify files present
  const filesList = repo.listRepoFiles();
  const files = filesList.files.map(f => f.name);
  assert(files.length === 2, 'Should have 2 files (base + same)');
  
  cleanupTestDB(testDB);
  console.log('✅ Merge with same additions test passed');
}

function testMergeBinaryFiles() {
  console.log('Testing merge with binary files...');

  const { repo, testDB } = createTestRepo();

  // Create binary content (simulated)
  const imageBinary = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]); // PNG header
  const docBinary = Buffer.from([0x50, 0x4B, 0x03, 0x04]); // ZIP header (for DOCX)

  // Base with binary file
  repo.addFile('image.png', imageBinary);
  const base = repo.commit('Add image');

  // Main branch: modify binary file
  const modifiedImage = Buffer.concat([imageBinary, Buffer.from('main-data')]);
  repo.addFile('image.png', modifiedImage);
  repo.commit('Main: update image');

  // Feature branch: different binary modification
  repo.createBranch('feature', base.commitHash);
  repo.switchBranch('feature');
  const featureImage = Buffer.concat([imageBinary, Buffer.from('feature-data')]);
  repo.addFile('image.png', featureImage);
  repo.commit('Feature: update image');

  // Merge should detect binary file conflict
  repo.switchBranch('main');
  const mergeResult = repo.merge('feature');

  assert(mergeResult.type === 'conflict', 'Binary files should create conflict');
  assert(mergeResult.conflicts[0].type === 'both-modified', 'Should be both-modified conflict');
  assert(mergeResult.conflicts[0].file === 'image.png', 'Should identify binary file');

  cleanupTestDB(testDB);
  console.log('✅ Binary files merge test passed');
}

function testMergeFileDeletionConflicts() {
  console.log('Testing merge with file deletion conflicts...');

  const { repo, testDB } = createTestRepo();

  // Base with file
  repo.addFile('document.txt', 'Important document');
  const base = repo.commit('Add document');

  // Main branch: modify the file
  repo.addFile('document.txt', 'Updated document content');
  repo.commit('Main: update document');

  // Feature branch: delete the file
  repo.createBranch('feature', base.commitHash);
  repo.switchBranch('feature');
  repo.rm(['document.txt']); // Use rm instead of removeFile for deletion
  repo.commit('Feature: remove document');

  // Merge should detect modify-delete conflict
  repo.switchBranch('main');
  const mergeResult = repo.merge('feature');

  assert(mergeResult.type === 'conflict', 'Modify-delete should create conflict');
  assert(mergeResult.conflicts[0].type === 'modified-deleted', 'Should be modify-delete conflict');
  assert(mergeResult.conflicts[0].file === 'document.txt', 'Should identify conflicting file');

  cleanupTestDB(testDB);
  console.log('✅ File deletion conflicts test passed');
}

function testMergeMultipleFileConflicts() {
  console.log('Testing merge with multiple file conflicts...');

  const { repo, testDB } = createTestRepo();

  // Base with multiple files
  repo.addFile('config.json', '{"version": "1.0"}');
  repo.addFile('readme.md', '# Project');
  repo.addFile('data.csv', 'name,value\ntest,123');
  const base = repo.commit('Base files');

  // Main branch: modify all files
  repo.addFile('config.json', '{"version": "1.1", "env": "main"}');
  repo.addFile('readme.md', '# Project (Main Branch)');
  repo.addFile('data.csv', 'name,value\ntest,456');
  repo.commit('Main: update all files');

  // Feature branch: modify same files differently
  repo.createBranch('feature', base.commitHash);
  repo.switchBranch('feature');
  repo.addFile('config.json', '{"version": "1.2", "env": "feature"}');
  repo.addFile('readme.md', '# Project (Feature Branch)');
  repo.addFile('data.csv', 'name,value\ntest,789');
  repo.commit('Feature: update all files');

  // Merge should detect conflicts in all 3 files
  repo.switchBranch('main');
  const mergeResult = repo.merge('feature');

  assert(mergeResult.type === 'conflict', 'Should detect multiple conflicts');
  assert(mergeResult.conflicts.length === 3, 'Should have 3 conflicts');

  const conflictFiles = mergeResult.conflicts.map(c => c.file).sort();
  assert(conflictFiles.includes('config.json'), 'Should conflict on config.json');
  assert(conflictFiles.includes('readme.md'), 'Should conflict on readme.md');
  assert(conflictFiles.includes('data.csv'), 'Should conflict on data.csv');

  cleanupTestDB(testDB);
  console.log('✅ Multiple file conflicts test passed');
}

function testMergeIndependentFiles() {
  console.log('Testing merge with independent file changes...');

  const { repo, testDB } = createTestRepo();

  // Base with multiple files
  repo.addFile('shared.txt', 'Shared content');
  const base = repo.commit('Base');

  // Main branch: add main-specific files
  repo.addFile('main-feature.js', 'main implementation');
  repo.addFile('main-config.xml', '<config>main</config>');
  repo.commit('Main: add features');

  // Feature branch: add different files
  repo.createBranch('feature', base.commitHash);
  repo.switchBranch('feature');
  repo.addFile('feature-logic.py', 'def feature(): pass');
  repo.addFile('feature-data.json', '{"feature": true}');
  repo.commit('Feature: add features');

  // Merge should succeed with no conflicts - files are independent
  repo.switchBranch('main');
  const mergeResult = repo.merge('feature');

  assert(mergeResult.type === 'three-way', 'Should be three-way merge');
  assert(mergeResult.conflicts.length === 0, 'Should have no conflicts');

  // Verify all files are present after merge
  const filesList = repo.listRepoFiles();
  const files = filesList.files.map(f => f.name);
  const fileNames = files.sort();

  assert(fileNames.includes('shared.txt'), 'Should have shared file');
  assert(fileNames.includes('main-feature.js'), 'Should have main file');
  assert(fileNames.includes('main-config.xml'), 'Should have main config');
  assert(fileNames.includes('feature-logic.py'), 'Should have feature file');
  assert(fileNames.includes('feature-data.json'), 'Should have feature data');

  cleanupTestDB(testDB);
  console.log('✅ Independent files merge test passed');
}

function testMergeFileRenameScenarios() {
  console.log('Testing merge file rename scenarios...');

  const { repo, testDB } = createTestRepo();

  // Base with file
  repo.addFile('original.txt', 'File content');
  const base = repo.commit('Add original file');

  // Main branch: "rename" by delete+add
  repo.rm(['original.txt']);
  repo.addFile('renamed-main.txt', 'File content');
  repo.commit('Main: rename file');

  // Feature branch: modify original file
  repo.createBranch('feature', base.commitHash);
  repo.switchBranch('feature');
  repo.addFile('original.txt', 'Modified file content');
  repo.commit('Feature: modify original');

  // Merge should show: feature modified original.txt, main deleted it
  repo.switchBranch('main');
  const mergeResult = repo.merge('feature');

  assert(mergeResult.type === 'conflict', 'Should detect rename conflict');
  assert(mergeResult.conflicts[0].type === 'deleted-modified', 'Should be delete-modify conflict');

  cleanupTestDB(testDB);
  console.log('✅ File rename scenarios test passed');
}

// Run all tests
function runMergeTests() {
  console.log('Running Merge Tests...\n');
  
  try {
    testFastForwardMerge();
    testThreeWayMerge();
    testMergeWithConflicts();
    testMergeUpToDate();
    testMergeNonExistentBranch();
    testMergeSameBranch();
    testMergeEmptyBranch();
    testMergeIntoEmptyBranch();
    testMergeWithFileAdditions();
    testMergeWithSameAdditions();
    testMergeBinaryFiles();
    testMergeFileDeletionConflicts();
    testMergeMultipleFileConflicts();
    testMergeIndependentFiles();
    testMergeFileRenameScenarios();
    
    console.log('\n✅ All merge tests passed!');
    return true;
  } catch (error) {
    console.error(`\n❌ Test failed: ${error.message}`);
    console.error(error.stack);
    return false;
  } finally {
    // Clean up test database files
    for (let i = 1; i <= testCounter; i++) {
      const testDb = path.join(__dirname, `test-merge-${i}.sqlite`);
      cleanupTestDB(testDb);
    }
  }
}

// Export for use by other test files
module.exports = { runMergeTests };

// Run tests if called directly
if (require.main === module) {
  process.exit(runMergeTests() ? 0 : 1);
}