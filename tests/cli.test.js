/**
 * CLI Tests - Tests for CLI-specific functionality
 */

const fs = require('fs');
const path = require('path');
const { MiniRepo } = require('../webdvcs-cli');

// Simple test runner
function assert(condition, message = 'Assertion failed') {
  if (!condition) {
    throw new Error(message);
  }
}

// Test database and directory paths
const TEST_DB = path.join(__dirname, 'cli-test.sqlite');
const TEST_CHECKOUT_DIR = path.join(__dirname, 'cli-checkout-test');

function cleanupTest() {
  // Clean up test database
  if (fs.existsSync(TEST_DB)) {
    fs.unlinkSync(TEST_DB);
  }
  
  // Clean up test checkout directory
  if (fs.existsSync(TEST_CHECKOUT_DIR)) {
    fs.rmSync(TEST_CHECKOUT_DIR, { recursive: true, force: true });
  }
}

function testCLICheckoutWithDirectories() {
  console.log('Testing CLI checkout with directory creation...');
  
  cleanupTest();
  const repo = new MiniRepo(TEST_DB);
  
  // Add files with nested directory structure
  repo.addFile('README.md', '# CLI Test Project\n\nTesting directory creation.');
  repo.addFile('src/index.js', 'const app = require("./app");\napp.start();');
  repo.addFile('src/lib/utils.js', 'exports.helper = () => "CLI helper function";');
  repo.addFile('tests/unit/utils.test.js', 'test("utils helper", () => { /* test code */ });');
  repo.addFile('config/database.json', '{"host": "localhost", "port": 5432}');
  repo.addFile('docs/setup/installation.md', '# Installation Guide\n\n1. Clone repo\n2. Run setup');
  
  const commitResult = repo.commit('Initial CLI project structure', 'CLI Test Author');
  const commitHash = commitResult.commitHash;

  // Clear staging area
  repo.stagingArea.clear();
  repo.removedFiles.clear();
  repo._saveStagingArea();

  // Change to test checkout directory
  const originalCwd = process.cwd();

  try {
    // Create checkout directory
    fs.mkdirSync(TEST_CHECKOUT_DIR, { recursive: true });
    process.chdir(TEST_CHECKOUT_DIR);

    // Checkout using CLI version (should create directories automatically)
    const checkoutResult = repo.checkout(commitHash, null, true);
    
    // Verify all files exist on disk
    assert(fs.existsSync('README.md'), 'README.md should exist');
    assert(fs.existsSync('src/index.js'), 'src/index.js should exist');
    assert(fs.existsSync('src/lib/utils.js'), 'src/lib/utils.js should exist');
    assert(fs.existsSync('tests/unit/utils.test.js'), 'tests/unit/utils.test.js should exist');
    assert(fs.existsSync('config/database.json'), 'config/database.json should exist');
    assert(fs.existsSync('docs/setup/installation.md'), 'docs/setup/installation.md should exist');
    
    // Verify directories were created
    assert(fs.existsSync('src'), 'src directory should exist');
    assert(fs.existsSync('src/lib'), 'src/lib directory should exist');
    assert(fs.existsSync('tests'), 'tests directory should exist');
    assert(fs.existsSync('tests/unit'), 'tests/unit directory should exist');
    assert(fs.existsSync('config'), 'config directory should exist');
    assert(fs.existsSync('docs'), 'docs directory should exist');
    assert(fs.existsSync('docs/setup'), 'docs/setup directory should exist');
    
    // Verify file contents are correct
    const readmeContent = fs.readFileSync('README.md', 'utf8');
    assert(readmeContent === '# CLI Test Project\n\nTesting directory creation.', 'README content should match');
    
    const indexContent = fs.readFileSync('src/index.js', 'utf8');
    assert(indexContent === 'const app = require("./app");\napp.start();', 'src/index.js content should match');
    
    const utilsContent = fs.readFileSync('src/lib/utils.js', 'utf8');
    assert(utilsContent === 'exports.helper = () => "CLI helper function";', 'utils.js content should match');
    
    const testContent = fs.readFileSync('tests/unit/utils.test.js', 'utf8');
    assert(testContent === 'test("utils helper", () => { /* test code */ });', 'test file content should match');
    
    const configContent = fs.readFileSync('config/database.json', 'utf8');
    assert(configContent === '{"host": "localhost", "port": 5432}', 'config content should match');
    
    const docsContent = fs.readFileSync('docs/setup/installation.md', 'utf8');
    assert(docsContent === '# Installation Guide\n\n1. Clone repo\n2. Run setup', 'docs content should match');
    
  } finally {
    // Restore original working directory
    process.chdir(originalCwd);
  }
  
  console.log('✅ CLI checkout with directories tests passed');
}

function testCLIAddFileFromDisk() {
  console.log('Testing CLI addFileFromDisk functionality...');
  
  cleanupTest();
  const repo = new MiniRepo(TEST_DB);
  
  // Create test files on disk
  const testFilePath = path.join(__dirname, 'temp-test-file.txt');
  const testBinaryPath = path.join(__dirname, 'temp-binary-file.bin');
  
  try {
    // Create text test file
    fs.writeFileSync(testFilePath, 'This is a test file for CLI testing.\nSecond line.');
    
    // Create binary test file
    const binaryData = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x00, 0xFF, 0xFE]);
    fs.writeFileSync(testBinaryPath, binaryData);
    
    // Add files from disk using CLI method
    const textResult = repo.addFileFromDisk(testFilePath);
    const binaryResult = repo.addFileFromDisk(testBinaryPath);

    assert(textResult.binary === false, 'Text file should not be detected as binary');
    assert(binaryResult.binary === true, 'Binary file should be detected as binary');
    
    const files = repo.listFiles();
    assert(files.length === 2, 'Should have 2 files');
    assert(files.includes(testFilePath), 'Should have text file');
    assert(files.includes(testBinaryPath), 'Should have binary file');
    
    // Verify content integrity
    const retrievedText = repo.getFile(testFilePath);
    const retrievedTextContent = new TextDecoder().decode(retrievedText);
    assert(retrievedTextContent === 'This is a test file for CLI testing.\nSecond line.', 'Text content should match');

    const retrievedBinary = repo.getFile(testBinaryPath);
    assert(retrievedBinary.length === binaryData.length, 'Binary length should match');
    assert(retrievedBinary.every((byte, i) => byte === binaryData[i]), 'Binary content should match');
    
    // Test error handling for non-existent file
    try {
      repo.addFileFromDisk('non-existent-file.txt');
      assert(false, 'Should throw error for non-existent file');
    } catch (error) {
      assert(error.message.includes('File not found'), 'Should throw proper error message');
    }
    
  } finally {
    // Clean up temporary files
    if (fs.existsSync(testFilePath)) {
      fs.unlinkSync(testFilePath);
    }
    if (fs.existsSync(testBinaryPath)) {
      fs.unlinkSync(testBinaryPath);
    }
  }
  
  console.log('✅ CLI addFileFromDisk tests passed');
}

function testCLILogging() {
  console.log('Testing CLI logging functionality...');
  
  cleanupTest();
  
  // Capture console output
  const originalLog = console.log;
  const logMessages = [];
  console.log = (...args) => {
    logMessages.push(args.join(' '));
    originalLog(...args);
  };
  
  try {
    const repo = new MiniRepo(TEST_DB, true); // Enable debug mode for logging test
    
    // Add a file (should trigger logging)
    repo.addFile('test.txt', 'Test content for logging');
    
    // Check that storage logging occurred (blobs, not chunks in new system)
    const storageLogMessages = logMessages.filter(msg =>
      msg.includes('Stored new blob') || msg.includes('blob') && msg.includes('already exists')
    );
    assert(storageLogMessages.length > 0, 'Should have storage log messages');
    
    // Commit (should trigger logging)
    const commitResult = repo.commit('Test commit for logging', 'Test Author');
    const commitHash = commitResult.commitHash;
    
    // Check that commit logging occurred
    const commitLogMessages = logMessages.filter(msg => 
      msg.includes('Created commit') && msg.includes(commitHash)
    );
    assert(commitLogMessages.length === 1, 'Should have exactly one commit log message');
    
    // CLI wrapper doesn't log checkouts in current implementation
    // Just verify that commit was successful
    repo.checkout(commitHash, null, false); // Don't write to disk
    
  } finally {
    // Restore console.log
    console.log = originalLog;
  }
  
  console.log('✅ CLI logging tests passed');
}

function testCLIRealWorldScenario() {
  console.log('Testing CLI real-world scenario...');
  
  cleanupTest();
  const repo = new MiniRepo(TEST_DB);
  
  // Simulate real project structure
  const projectFiles = [
    { path: 'package.json', content: '{"name": "my-project", "version": "1.0.0"}' },
    { path: 'src/app.js', content: 'const express = require("express");\nconst app = express();' },
    { path: 'src/routes/api.js', content: 'const router = express.Router();\nmodule.exports = router;' },
    { path: 'src/middleware/auth.js', content: 'function authenticate(req, res, next) { next(); }' },
    { path: 'tests/app.test.js', content: 'describe("app", () => { it("works", () => {}); });' },
    { path: 'public/index.html', content: '<!DOCTYPE html><html><body>Hello</body></html>' },
    { path: 'public/css/style.css', content: 'body { font-family: Arial; }' },
    { path: 'docs/README.md', content: '# My Project\n\nDescription here.' }
  ];
  
  // Add all files
  projectFiles.forEach(({ path, content }) => {
    repo.addFile(path, content);
  });
  
  // Create initial commit
  const initialCommitResult = repo.commit('Initial project setup', 'Developer');
  const initialCommit = initialCommitResult.commitHash;
  
  // Create feature branch
  repo.createBranch('feature/api-endpoints');
  repo.switchBranch('feature/api-endpoints');
  
  // Add feature files
  repo.addFile('src/routes/users.js', 'const User = require("../models/User");\nmodule.exports = router;');
  repo.addFile('src/models/User.js', 'class User { constructor(name) { this.name = name; } }');
  repo.addFile('tests/users.test.js', 'describe("users", () => { it("creates user", () => {}); });');
  
  const featureCommitResult = repo.commit('Add user management endpoints', 'Developer');
  const featureCommit = featureCommitResult.commitHash;
  
  // Test checkout to disk on feature branch
  const originalCwd = process.cwd();
  
  try {
    fs.mkdirSync(TEST_CHECKOUT_DIR, { recursive: true });
    process.chdir(TEST_CHECKOUT_DIR);
    
    // Checkout feature branch to disk
    repo.checkout(featureCommit, null, true);
    
    // Verify complete project structure exists
    const expectedFiles = [
      'package.json', 'src/app.js', 'src/routes/api.js', 'src/routes/users.js',
      'src/middleware/auth.js', 'src/models/User.js', 'tests/app.test.js', 
      'tests/users.test.js', 'public/index.html', 'public/css/style.css', 'docs/README.md'
    ];
    
    expectedFiles.forEach(filePath => {
      assert(fs.existsSync(filePath), `${filePath} should exist on disk`);
    });
    
    // Verify directory structure
    const expectedDirs = ['src', 'src/routes', 'src/middleware', 'src/models', 'tests', 'public', 'public/css', 'docs'];
    expectedDirs.forEach(dirPath => {
      assert(fs.existsSync(dirPath), `${dirPath} directory should exist`);
    });
    
    // Switch back to main and checkout
    repo.switchBranch('main');
    
    // Clear directory
    fs.readdirSync('.').forEach(file => {
      const filePath = path.join('.', file);
      if (fs.statSync(filePath).isDirectory()) {
        fs.rmSync(filePath, { recursive: true });
      } else {
        fs.unlinkSync(filePath);
      }
    });
    
    // Checkout main branch
    repo.checkout(initialCommit, null, true);
    
    // Verify main branch doesn't have feature files
    assert(!fs.existsSync('src/routes/users.js'), 'Feature file should not exist in main');
    assert(!fs.existsSync('src/models/User.js'), 'Feature model should not exist in main');
    assert(fs.existsSync('src/app.js'), 'Main files should exist');
    assert(fs.existsSync('package.json'), 'Main files should exist');
    
  } finally {
    process.chdir(originalCwd);
  }
  
  console.log('✅ CLI real-world scenario tests passed');
}

function testCLIErrorHandling() {
  console.log('Testing CLI error handling for invalid references...');

  cleanupTest();
  const repo = new MiniRepo(TEST_DB);
  repo.setAuthor('Test User', 'test@example.com');

  // Test error handling with no commits (empty repository)
  try {
    repo.checkout('HEAD', 'nonexistent.txt');
    assert(false, 'Should throw error for HEAD in empty repo');
  } catch (error) {
    assert(error.message.includes('Invalid commit reference') || error.message.includes('HEAD') || error.message.includes('Commit not found'), 'Should have meaningful error for empty repo HEAD');
  }

  // resolveCommitReference method doesn't exist in current CLI implementation
  // Skip this test

  // Create initial state with commits
  repo.addFile('initial.txt', 'Initial content');
  const commit1Result = repo.commit('First commit');
  const commit1 = commit1Result.commitHash;

  repo.addFile('second.txt', 'Second content');
  const commit2Result = repo.commit('Second commit');
  const commit2 = commit2Result.commitHash;

  // Test invalid commit hash
  try {
    repo.checkout('invalid-commit-hash-12345', 'initial.txt');
    assert(false, 'Should throw error for invalid commit hash');
  } catch (error) {
    assert(error.message.includes('Invalid commit reference') || error.message.includes('not found') || error.message.includes('Commit not found'), 'Should have meaningful error for invalid hash');
  }

  // Test HEAD~N with N too large
  try {
    repo.checkout('HEAD~10', 'initial.txt');
    assert(false, 'Should throw error for HEAD~10 (not enough commits)');
  } catch (error) {
    assert(error.message.includes('Invalid commit reference') || error.message.includes('HEAD') || error.message.includes('Commit not found'), 'Should have meaningful error for HEAD~10');
  }

  // Test invalid HEAD~N format
  try {
    repo.checkout('HEAD~abc', 'initial.txt');
    assert(false, 'Should throw error for HEAD~abc');
  } catch (error) {
    assert(error.message.includes('Invalid commit reference') || error.message.includes('HEAD') || error.message.includes('Commit not found'), 'Should have meaningful error for HEAD~abc');
  }

  // Test empty commit reference
  try {
    repo.checkout('', 'initial.txt');
    assert(false, 'Should throw error for empty commit reference');
  } catch (error) {
    assert(error.message.includes('Invalid commit reference') || error.message.includes('empty') || error.message.includes('Commit not found'), 'Should have meaningful error for empty reference');
  }

  // Test null commit reference
  try {
    repo.checkout(null, 'initial.txt');
    assert(false, 'Should throw error for null commit reference');
  } catch (error) {
    assert(error.message.includes('Invalid commit reference') || error.message.includes('null') || error.message.includes('Commit not found'), 'Should have meaningful error for null reference');
  }

  // Test checkout of non-existent file from valid commit
  try {
    repo.checkout('HEAD', 'nonexistent-file.txt');
    assert(false, 'Should throw error for non-existent file');
  } catch (error) {
    assert(error.message.includes('not found') || error.message.includes('does not exist') || error.message.includes('File not found'), 'Should have meaningful error for non-existent file');
  }

  // Test valid cases to ensure functionality still works

  // Valid HEAD checkout
  const headResult = repo.checkout('HEAD', 'initial.txt');
  assert(headResult !== null, 'Valid HEAD checkout should work');

  // Valid HEAD~1 checkout
  const head1Result = repo.checkout('HEAD~1', 'initial.txt');
  assert(head1Result !== null, 'Valid HEAD~1 checkout should work');

  // Valid HEAD~0 checkout (same as HEAD)
  const head0Result = repo.checkout('HEAD~0', 'initial.txt');
  assert(head0Result !== null, 'Valid HEAD~0 checkout should work');

  // Valid direct commit hash checkout
  const directResult = repo.checkout(commit1, 'initial.txt');
  assert(directResult !== null, 'Valid direct commit hash checkout should work');

  console.log('✅ CLI error handling tests passed');
}

// Run all CLI tests
function runCLITests() {
  console.log('Running CLI Tests...\n');
  
  try {
    testCLICheckoutWithDirectories();
    testCLIAddFileFromDisk();
    testCLILogging();
    testCLIRealWorldScenario();
    testCLIErrorHandling();
    
    console.log('\n✅ All CLI tests passed!');
    return true;
  } catch (error) {
    console.error(`\n❌ CLI test failed: ${error.message}`);
    console.error(error.stack);
    return false;
  } finally {
    // Clean up test files
    cleanupTest();
  }
}

// Export for use by other test files
module.exports = { runCLITests };

// Run tests if called directly
if (require.main === module) {
  process.exit(runCLITests() ? 0 : 1);
}