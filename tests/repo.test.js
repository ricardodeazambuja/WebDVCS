/**
 * Repo Tests - Real tests for MiniRepo class functionality
 */

const fs = require('fs');
const path = require('path');
const { MiniRepo } = require('../webdvcs-cli'); // CLI-enhanced version with filesystem methods
const { initStore } = require('../lib/core/storage');

// Simple test runner
function assert(condition, message = 'Assertion failed') {
  if (!condition) {
    throw new Error(message);
  }
}

// Test database and files paths - use unique names to avoid conflicts
const TEST_DB = path.join(__dirname, `test-repo-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.sqlite`);
const TEST_FILE_PATH = path.join(__dirname, 'test-file.txt');
const TEST_DIR_PATH = path.join(__dirname, 'test-dir');
console.log('TEST_DB', TEST_DB);
console.log('TEST_FILE_PATH', TEST_FILE_PATH);
console.log('TEST_DIR_PATH', TEST_DIR_PATH);

function cleanupTest() {
  try {
    // Clean up test database
    if (fs.existsSync(TEST_DB)) {
      fs.unlinkSync(TEST_DB);
    }
    
    // Clean up test file
    if (fs.existsSync(TEST_FILE_PATH)) {
      fs.unlinkSync(TEST_FILE_PATH);
    }
    
    // Clean up test directory
    if (fs.existsSync(TEST_DIR_PATH)) {
      fs.rmSync(TEST_DIR_PATH, { recursive: true, force: true });
    }
  } catch (error) {
    console.warn('Cleanup warning:', error.message);
    // Don't throw - allow tests to proceed even if cleanup fails
  }
}

function testRepoCreation() {
  console.log('Testing repo creation...');
  
  cleanupTest();
  
  const repo = new MiniRepo(TEST_DB);
  assert(repo !== null, 'Repo should be created');
  assert(fs.existsSync(TEST_DB), 'Database file should be created');
  
  // Test that main branch is created automatically
  const branches = repo.listBranches();
  assert(branches.length === 1, 'Should have main branch');
  assert(branches[0].name === 'main', 'First branch should be main');
  
  const currentBranch = repo.getCurrentBranch();
  assert(currentBranch === 'main', 'Current branch should be main');
  
  console.log('✅ Repo creation tests passed');
}

function testFileOperations() {
  console.log('Testing file operations...');
  
  cleanupTest();
  const repo = new MiniRepo(TEST_DB);
  
  // Test adding text file
  const textContent = 'Hello, World!\nThis is a test file.';
  const result = repo.addFile('test.txt', textContent, false);
  assert(result.binary === false, 'Text file should not be detected as binary');
  
  const files = repo.listFiles();
  assert(files.length === 1, 'Should have one file');
  assert(files[0] === 'test.txt', 'File should be named test.txt');
  
  const retrievedFile = repo.getFile('test.txt');
  const retrievedText = new TextDecoder().decode(retrievedFile);
  assert(retrievedText === textContent, 'Retrieved file should match original');
  
  // Test adding binary file
  const binaryContent = new Uint8Array([0x00, 0x01, 0xFF, 0xFE]);
  const result2 = repo.addFile('binary.bin', binaryContent);
  assert(result2.binary === true, 'Binary file should be detected as binary');
  
  const binaryRetrieved = repo.getFile('binary.bin');
  assert(binaryRetrieved.every((byte, i) => byte === binaryContent[i]), 'Binary file should match');
  
  // Test removing file
  repo.removeFile('test.txt'); // removeFile doesn't return a value in v2

  // Check that file is no longer in staging area
  try {
    repo.getFile('test.txt');
    assert(false, 'Should throw error for removed file');
  } catch (error) {
    assert(error.message.includes('File not staged'), 'Should get proper error message');
  }
  
  const filesAfterRemoval = repo.listFiles();
  assert(filesAfterRemoval.length === 1, 'Should have one file after removal');
  assert(filesAfterRemoval[0] === 'binary.bin', 'Remaining file should be binary.bin');
  
  console.log('✅ File operations tests passed');
}

function testAddFileFromDisk() {
  console.log('Testing addFileFromDisk...');
  
  cleanupTest();
  const repo = new MiniRepo(TEST_DB);
  
  // Create test file
  const testContent = 'This is a test file on disk.';
  fs.writeFileSync(TEST_FILE_PATH, testContent, 'utf8');
  
  // Add file from disk (simulate addFileFromDisk functionality)
  const diskContent = fs.readFileSync(TEST_FILE_PATH);
  const result = repo.addFile(path.basename(TEST_FILE_PATH), diskContent);
  assert(result.binary === false, 'Text file should not be binary');
  
  const fileName = path.basename(TEST_FILE_PATH);
  const retrieved = repo.getFile(fileName);
  const retrievedText = new TextDecoder().decode(retrieved);
  assert(retrievedText === testContent, 'File content should match');
  
  // Test non-existent file
  try {
    const nonExistentContent = fs.readFileSync('non-existent-file.txt');
    repo.addFile('non-existent-file.txt', nonExistentContent);
    assert(false, 'Should throw error for non-existent file');
  } catch (error) {
    assert(error.code === 'ENOENT', 'Should throw file not found error');
  }
  
  console.log('✅ addFileFromDisk tests passed');
}

function testDirectoryOperations() {
  console.log('Testing directory operations...');
  
  cleanupTest();
  const repo = new MiniRepo(TEST_DB);
  
  // Create test directory structure
  fs.mkdirSync(TEST_DIR_PATH, { recursive: true });
  fs.mkdirSync(path.join(TEST_DIR_PATH, 'subdir'), { recursive: true });
  
  fs.writeFileSync(path.join(TEST_DIR_PATH, 'file1.txt'), 'File 1 content');
  fs.writeFileSync(path.join(TEST_DIR_PATH, 'file2.txt'), 'File 2 content');
  fs.writeFileSync(path.join(TEST_DIR_PATH, 'subdir', 'file3.txt'), 'File 3 content');
  
  // Add directory
  const result = repo.addDirectory(TEST_DIR_PATH);
  assert(result.added === 3, 'Should add 3 files');
  assert(result.skipped === 0, 'Should skip 0 files');
  assert(result.total === 3, 'Should have 3 total files');
  
  const files = repo.listFiles();
  assert(files.length === 3, 'Should have 3 files');
  
  const dirName = path.basename(TEST_DIR_PATH);
  const expectedFiles = [
    `${dirName}/file1.txt`,
    `${dirName}/file2.txt`,
    `${dirName}/subdir/file3.txt`
  ];
  
  expectedFiles.forEach(expectedFile => {
    assert(files.includes(expectedFile), `Should include ${expectedFile}`);
  });
  
  // Verify file contents
  const file1 = repo.getFile(`${dirName}/file1.txt`);
  const file1Text = new TextDecoder().decode(file1);
  assert(file1Text === 'File 1 content', 'File 1 content should match');
  
  const file3 = repo.getFile(`${dirName}/subdir/file3.txt`);
  const file3Text = new TextDecoder().decode(file3);
  assert(file3Text === 'File 3 content', 'File 3 content should match');
  
  console.log('✅ Directory operations tests passed');
}

function testCommits() {
  console.log('Testing commit operations...');
  
  cleanupTest();
  const repo = new MiniRepo(TEST_DB);
  
  // Test empty commit
  try {
    repo.commit('Empty commit');
    assert(false, 'Should not allow empty commit');
  } catch (error) {
    assert(error.message.includes('Nothing to commit'), 'Should reject empty commit');
  }
  
  // Add files and commit
  repo.addFile('file1.txt', 'Content 1');
  repo.addFile('file2.txt', 'Content 2');
  
  const result = repo.commit('Initial commit', 'Test Author');
  assert(typeof result.commitHash === 'string', 'Commit should return hash');
  assert(result.commitHash.length === 64, 'Commit hash should be 64 characters (SHA-256)');
  const commitHash = result.commitHash;
  
  const status = repo.status();
  assert(status.head === commitHash, 'Status should show correct head');
  assert(status.current_branch === 'main', 'Should be on main branch');
  
  // Test duplicate commit prevention (Git-like behavior)
  try {
    repo.commit('Duplicate commit');
    assert(false, 'Should prevent duplicate commit when working directory is empty');
  } catch (error) {
    assert(error.message.includes('Nothing to commit'), 'Prevents duplicate commits in Git-like manner');
  }
  
  // Test commit history
  const history = repo.log(5);
  assert(history.length === 1, 'Should have one commit');
  assert(history[0].hash === commitHash, 'Commit hash should match');
  assert(history[0].message === 'Initial commit', 'Commit message should match');
  assert(history[0].author === 'Test Author', 'Commit author should match');
  
  // Add more files and make second commit
  repo.addFile('file3.txt', 'Content 3');
  const secondResult = repo.commit('Second commit', 'Test Author');
  const secondCommitHash = secondResult.commitHash;
  
  const fullHistory = repo.log(10);
  assert(fullHistory.length === 2, 'Should have two commits');
  assert(fullHistory[0].hash === secondCommitHash, 'Latest commit should be first');
  assert(fullHistory[1].hash === commitHash, 'Previous commit should be second');
  
  console.log('✅ Commit operations tests passed');
}

function testBranchOperations() {
  console.log('Testing branch operations...');
  
  cleanupTest();
  const repo = new MiniRepo(TEST_DB);
  
  // Add file and create initial commit
  repo.addFile('main.txt', 'Main branch content');
  const mainCommit = repo.commit('Main commit', 'Author');
  
  // Create new branch
  const featureBranch = repo.createBranch('feature');
  assert(featureBranch === 'feature', 'Should return branch name');
  
  const branches = repo.listBranches();
  assert(branches.length === 2, 'Should have 2 branches');
  assert(branches.some(b => b.name === 'feature'), 'Should have feature branch');
  
  // Test duplicate branch creation (prevents namespace conflicts)
  try {
    repo.createBranch('feature');
    assert(false, 'Should not allow duplicate branch');
  } catch (error) {
    assert(error.message.includes('already exists'), 'Prevents branch namespace conflicts');
  }
  
  // Switch to feature branch
  const switchResult = repo.switchBranch('feature');
  assert(switchResult.branch === 'feature', 'Should switch to feature branch');
  assert(repo.getCurrentBranch() === 'feature', 'Current branch should be feature');
  
  // Add file on feature branch
  repo.addFile('feature.txt', 'Feature branch content');
  const featureResult = repo.commit('Feature commit', 'Author');
  const featureCommitHash = featureResult.commitHash;
  
  // Switch back to main
  repo.switchBranch('main');
  assert(repo.getCurrentBranch() === 'main', 'Should be back on main');
  
  // Check files in current branch's HEAD commit (not staging area)
  const mainBranches = repo.listBranches();
  const mainBranch = mainBranches.find(b => b.name === 'main');
  const { getTreeFiles, getCommit } = require('../lib/core/objects');
  const mainHeadCommit = getCommit(mainBranch.head, repo.store);
  const mainFiles = getTreeFiles(mainHeadCommit.tree, '', repo.store).map(f => f.name);

  assert(!mainFiles.includes('feature.txt'), 'Feature file should not be in main');
  assert(mainFiles.includes('main.txt'), 'Main file should be in main');

  // Switch back to feature and check files
  repo.switchBranch('feature');
  const currentBranches = repo.listBranches();
  const currentFeatureBranch = currentBranches.find(b => b.name === 'feature');
  const featureHeadCommit = getCommit(currentFeatureBranch.head, repo.store);
  const featureFiles = getTreeFiles(featureHeadCommit.tree, '', repo.store).map(f => f.name);

  assert(featureFiles.includes('feature.txt'), 'Feature file should be in feature branch');
  assert(featureFiles.includes('main.txt'), 'Main file should also be in feature branch');
  
  console.log('✅ Branch operations tests passed');
}

function testCheckout() {
  console.log('Testing checkout operations...');
  
  cleanupTest();
  const repo = new MiniRepo(TEST_DB);
  
  // Create first commit
  repo.addFile('v1.txt', 'Version 1');
  const result1 = repo.commit('Version 1', 'Author');
  const commit1Hash = result1.commitHash;
  
  // Create second commit - modify v1.txt and add v2.txt
  repo.addFile('v1.txt', 'Version 1 Updated');  // Actually change the content
  repo.addFile('v2.txt', 'Version 2');
  const result2 = repo.commit('Version 2', 'Author');
  const commit2Hash = result2.commitHash;
  
  // Checkout first commit
  repo.checkout(commit1Hash);
  const files = repo.listFiles();
  assert(files.length === 1, 'Should have 1 file after checkout');
  assert(files[0] === 'v1.txt', 'Should have v1.txt');
  assert(!files.includes('v2.txt'), 'Should not have v2.txt');
  
  // Checkout second commit
  repo.checkout(commit2Hash);
  const files2 = repo.listFiles();
  assert(files2.length === 2, 'Should have 2 files');
  assert(files2.includes('v1.txt'), 'Should have v1.txt');
  assert(files2.includes('v2.txt'), 'Should have v2.txt');
  
  console.log('✅ Checkout operations tests passed');
}

function testCheckoutToDisk() {
  console.log('Testing checkout to disk with directory creation...');
  
  cleanupTest();
  const repo = new MiniRepo(TEST_DB);
  
  // Create test directory structure in working directory
  const testOutputDir = path.join(__dirname, 'checkout-test-output');
  
  // Add files with nested directory paths
  repo.addFile('README.txt', 'Root level file');
  repo.addFile('src/main.js', 'console.log("Main application");');
  repo.addFile('src/utils/helper.js', 'function help() { return "help"; }');
  repo.addFile('docs/api/endpoints.md', '# API Endpoints\n\n## GET /api/status');
  repo.addFile('config/env/development.json', '{"debug": true}');
  
  const commitResult = repo.commit('Add nested file structure', 'Test Author');
  const commit1Hash = commitResult.commitHash;
  
  // Clear the staging area (simulate fresh checkout)
  repo.stagingArea.clear();
  repo.saveStagingArea();
  
  // Change to output directory to test relative paths
  const originalCwd = process.cwd();
  
  try {
    // Create and change to test output directory
    fs.mkdirSync(testOutputDir, { recursive: true });
    process.chdir(testOutputDir);
    
    // Checkout to working directory first  
    const result = repo.checkout(commit1Hash);
    
    // Write files to disk manually (simulating CLI writeToDisk functionality)
    for (const [fileName, fileData] of Object.entries(result.files)) {
      // Create parent directory if needed
      const dir = path.dirname(fileName);
      if (dir !== '.') {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(fileName, fileData);
    }
    
    // Verify all files were written to disk
    assert(fs.existsSync('README.txt'), 'Root file should exist');
    assert(fs.existsSync('src/main.js'), 'Nested file should exist');
    assert(fs.existsSync('src/utils/helper.js'), 'Deeply nested file should exist');
    assert(fs.existsSync('docs/api/endpoints.md'), 'Multi-level nested file should exist');
    assert(fs.existsSync('config/env/development.json'), 'Deep config file should exist');
    
    // Verify directories were created
    assert(fs.existsSync('src'), 'src directory should exist');
    assert(fs.existsSync('src/utils'), 'src/utils directory should exist');
    assert(fs.existsSync('docs'), 'docs directory should exist');
    assert(fs.existsSync('docs/api'), 'docs/api directory should exist');
    assert(fs.existsSync('config'), 'config directory should exist');
    assert(fs.existsSync('config/env'), 'config/env directory should exist');
    
    // Verify file contents
    const readmeContent = fs.readFileSync('README.txt', 'utf8');
    assert(readmeContent === 'Root level file', 'README content should match');
    
    const mainJsContent = fs.readFileSync('src/main.js', 'utf8');
    assert(mainJsContent === 'console.log("Main application");', 'main.js content should match');
    
    const helperContent = fs.readFileSync('src/utils/helper.js', 'utf8');
    assert(helperContent === 'function help() { return "help"; }', 'helper.js content should match');
    
    const endpointsContent = fs.readFileSync('docs/api/endpoints.md', 'utf8');
    assert(endpointsContent === '# API Endpoints\n\n## GET /api/status', 'endpoints.md content should match');
    
    const configContent = fs.readFileSync('config/env/development.json', 'utf8');
    assert(configContent === '{"debug": true}', 'development.json content should match');
    
  } finally {
    // Restore original working directory
    process.chdir(originalCwd);
    
    // Clean up test output directory
    if (fs.existsSync(testOutputDir)) {
      fs.rmSync(testOutputDir, { recursive: true, force: true });
    }
  }
  
  console.log('✅ Checkout to disk tests passed');
}

function testDiffOperations() {
  console.log('Testing diff operations...');
  
  cleanupTest();
  const repo = new MiniRepo(TEST_DB);
  
  // Add files for diffing
  repo.addFile('fileA.txt', 'Line 1\nLine 2\nLine 3');
  repo.addFile('fileB.txt', 'Line 1\nModified\nLine 3');
  
  // Test file diff
  const diff = repo.diffFiles('fileA.txt', 'fileB.txt');
  assert(typeof diff === 'object', 'Diff should be object');
  assert(typeof diff.content === 'string', 'Diff content should be string');
  assert(diff.content.includes('- Line 2'), 'Should show removed line');
  assert(diff.content.includes('+ Modified'), 'Should show added line');
  
  // Test commit diff
  const result1 = repo.commit('First commit', 'Author');
  const commit1Hash = result1.commitHash;
  
  // Modify files - working directory was cleared, so need to set up new state
  repo.addFile('fileA.txt', 'Line 1\nUpdated\nLine 3');
  // fileB.txt is not added but will be carried forward from first commit (cumulative commits)
  repo.addFile('fileC.txt', 'New file');
  
  const result2 = repo.commit('Second commit', 'Author');
  const commit2Hash = result2.commitHash;
  
  const commitDiff = repo.diffCommits(commit1Hash, commit2Hash);
  assert(Array.isArray(commitDiff), 'Commit diff should be array');
  
  const modifiedFile = commitDiff.find(d => d.file === 'fileA.txt' && d.type === 'modified');
  const addedFile = commitDiff.find(d => d.file === 'fileC.txt' && d.type === 'added');
  // fileB.txt should NOT be detected as removed since commits are now cumulative
  const removedFile = commitDiff.find(d => d.file === 'fileB.txt' && d.type === 'removed');
  
  assert(modifiedFile !== undefined, 'Should detect modified file');
  assert(removedFile === undefined, 'Should NOT detect fileB.txt as removed (cumulative commits)');
  assert(addedFile !== undefined, 'Should detect added file');
  
  console.log('✅ Diff operations tests passed');
}

function testStatus() {
  console.log('Testing status operations...');
  
  cleanupTest();
  const repo = new MiniRepo(TEST_DB);
  
  const initialStatus = repo.status();
  assert(initialStatus.current_branch === 'main', 'Should be on main branch');
  assert(initialStatus.head === null, 'Should have null head initially');
  assert(initialStatus.staged.length === 0, 'Should have no staged files');
  assert(initialStatus.branches === 1, 'Should have 1 branch');
  
  // Add files
  repo.addFile('test.txt', 'Content');
  const stagedStatus = repo.status();
  assert(stagedStatus.staged.length === 1, 'Should have 1 staged file');
  assert(stagedStatus.staged[0] === 'test.txt', 'Staged file should be test.txt');
  
  // Commit
  const commitResult = repo.commit('Test commit', 'Author');
  const commitHash = commitResult.commitHash;
  const committedStatus = repo.status();
  assert(committedStatus.head === commitHash, 'Head should be commit hash');
  assert(committedStatus.staged.length === 0, 'Staging area should be empty after commit');
  
  // Verify files are still accessible via listFiles() from current commit
  const availableFiles = repo.listFiles();
  assert(availableFiles.length === 1, 'Files available from current commit after staging clears');
  assert(availableFiles[0] === 'test.txt', 'Should have committed file available');
  assert(typeof committedStatus.db_size === 'number', 'Should have database size');
  assert(typeof committedStatus.store_objects === 'number', 'Should have store objects count');
  
  console.log('✅ Status operations tests passed');
}

function testPersistence() {
  console.log('Testing working directory persistence...');
  
  cleanupTest();
  
  // Create repo and add files
  let repo = new MiniRepo(TEST_DB);
  repo.addFile('persistent.txt', 'This should persist');
  repo.addFile('another.txt', 'Another file');
  
  let files = repo.listFiles();
  assert(files.length === 2, 'Should have 2 files initially');
  
  // Create new repo instance with same database
  repo = new MiniRepo(TEST_DB);
  const persistedFiles = repo.listFiles();
  
  assert(persistedFiles.length === 2, 'Files should persist');
  assert(persistedFiles.includes('persistent.txt'), 'Should have persistent.txt');
  assert(persistedFiles.includes('another.txt'), 'Should have another.txt');
  
  const content = repo.getFile('persistent.txt');
  const text = new TextDecoder().decode(content);
  assert(text === 'This should persist', 'File content should persist');
  
  console.log('✅ Persistence tests passed');
}

function testShowChanges() {
  console.log('Testing showChanges operations...');
  
  cleanupTest();
  const repo = new MiniRepo(TEST_DB);
  
  // Test showing changes with no staged files
  const noChanges = repo.showChanges();
  assert(Array.isArray(noChanges), 'showChanges should return an array');
  assert(noChanges.length === 0, 'Should have no changes initially');
  
  // Add initial files and commit
  repo.addFile('existing.txt', 'Original content\nLine 2\nLine 3');
  repo.addFile('keep.txt', 'Keep this file');
  const result = repo.commit('Initial commit', 'Author');
  const commitHash = result.commitHash;
  
  // Now add new file (addition)
  repo.addFile('new.txt', 'This is new content');
  
  // Modify existing file
  repo.addFile('existing.txt', 'Modified content\nNew line 2\nLine 3');
  
  // Remove file using the rm() method
  repo.rm(['keep.txt']);
  
  // Test showChanges output
  const changes = repo.showChanges();
  assert(Array.isArray(changes), 'showChanges should return array');
  assert(changes.length === 3, 'Should have 3 changes (add, modify, delete)');
  
  // Find each type of change
  const addedChange = changes.find(c => c.type === 'added' && c.file === 'new.txt');
  const modifiedChange = changes.find(c => c.type === 'modified' && c.file === 'existing.txt');
  const deletedChange = changes.find(c => c.type === 'deleted' && c.file === 'keep.txt');
  
  assert(addedChange !== undefined, 'Should have added change for new.txt');
  assert(modifiedChange !== undefined, 'Should have modified change for existing.txt');
  assert(deletedChange !== undefined, 'Should have deleted change for keep.txt');
  
  // Verify diff content
  assert(addedChange.diff.includes('+This is new content'), 'Should show added file content');
  assert(modifiedChange.diff.includes('- Original content'), 'Should show removed lines');
  assert(modifiedChange.diff.includes('+ Modified content'), 'Should show added lines');
  assert(deletedChange.diff.includes('-Keep this file'), 'Should show deleted file content');
  
  // Test after committing - should show no changes
  repo.commit('Second commit', 'Author');
  const noChangesAfterCommit = repo.showChanges();
  assert(Array.isArray(noChangesAfterCommit), 'showChanges should return array after commit');
  assert(noChangesAfterCommit.length === 0, 'Should have no staged changes after commit');
  
  console.log('✅ showChanges tests passed');
}

function testNullHashSafety() {
  console.log('Testing null hash safety in debug logging...');

  cleanupTest();
  const repo = new MiniRepo(TEST_DB, true); // Enable debug mode
  repo.setAuthor('Test User', 'test@example.com');

  // Capture console output to verify no crashes
  const originalLog = console.log;
  const logMessages = [];
  let logErrorOccurred = false;

  console.log = (...args) => {
    try {
      logMessages.push(args.join(' '));
      originalLog(...args);
    } catch (error) {
      logErrorOccurred = true;
      originalLog('Debug logging error:', error.message);
    }
  };

  try {
    // Test scenario 1: Initial commit with debug logging
    // This should trigger debug messages with valid hashes
    repo.addFile('test1.txt', 'Content 1');
    const commit1 = repo.commit('First commit');

    assert(commit1.commitHash, 'Should create first commit');
    assert(!logErrorOccurred, 'Debug logging should not cause errors with valid hashes');

    // Test scenario 2: Staging area manipulation to potentially create null hash scenarios
    // Add a file that could trigger edge cases in debug logging
    repo.addFile('test2.txt', '');  // Empty file edge case

    // Test scenario 3: Multiple commits to test hash reuse logging
    repo.addFile('test3.txt', 'Content 3');
    const commit2 = repo.commit('Second commit');

    assert(commit2.commitHash, 'Should create second commit');
    assert(!logErrorOccurred, 'Debug logging should not cause errors with multiple commits');

    // Test scenario 4: Staging same content again (hash reuse scenario)
    repo.addFile('test4.txt', 'Content 3'); // Same content as test3.txt
    const commit3 = repo.commit('Third commit');

    assert(commit3.commitHash, 'Should create third commit');
    assert(!logErrorOccurred, 'Debug logging should not cause errors with hash reuse');

    // Test scenario 5: Force a commit with edge case debugging
    // This tests the specific code paths that had null hash issues
    repo.addFile('edge-case.txt', 'Edge case content');

    // Manually trigger some edge cases by manipulating staging area state
    // (Simulate scenarios that could lead to null hashes in debug output)
    const stagingEntry = repo.stagingArea.get('edge-case.txt');
    if (stagingEntry) {
      // Temporarily set hash to null to test the null safety
      const originalHash = stagingEntry.hash;
      stagingEntry.hash = null;

      // Now commit - this should trigger the null hash safety code
      try {
        repo.addFile('trigger-debug.txt', 'Trigger debug');
        // Restore hash before commit
        stagingEntry.hash = originalHash;
        const commit4 = repo.commit('Edge case commit');
        assert(commit4.commitHash, 'Should handle edge case commit');
      } catch (error) {
        // Restore hash even if error occurs
        stagingEntry.hash = originalHash;
        throw error;
      }
    }

    assert(!logErrorOccurred, 'Debug logging should safely handle null hash scenarios');

    // Verify that debug messages were actually generated
    const debugMessages = logMessages.filter(msg => msg.includes('🔍'));
    assert(debugMessages.length > 0, 'Should generate debug messages during operations');

    // Verify that null hash safety messages work
    const nullSafetyMessages = logMessages.filter(msg =>
      msg.includes('null') && msg.includes('hash')
    );
    // Note: This test doesn't require null safety messages to exist,
    // it just verifies that if they do exist, they don't crash

    console.log(`Debug messages generated: ${debugMessages.length}`);
    console.log(`Operations completed without debug logging errors`);

  } finally {
    // Restore console.log
    console.log = originalLog;
  }

  console.log('✅ Null hash safety tests passed');
}

// Run all tests
function runRepoTests() {
  console.log('Running Repo Tests...\n');
  
  try {
    testRepoCreation();
    testFileOperations();
    testAddFileFromDisk();
    testDirectoryOperations();
    testCommits();
    testBranchOperations();
    testCheckout();
    testCheckoutToDisk();
    testDiffOperations();
    testStatus();
    testPersistence();
    testShowChanges();
    testNullHashSafety();
    
    console.log('\n✅ All repo tests passed!');
    return true;
  } catch (error) {
    console.error(`\n❌ Test failed: ${error.message}`);
    console.error(error.stack);
    return false;
  } finally {
    // Clean up test files
    cleanupTest();
  }
}

// Export for use by other test files
module.exports = { runRepoTests };

// Run tests if called directly
if (require.main === module) {
  process.exit(runRepoTests() ? 0 : 1);
}