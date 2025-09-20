/**
 * Integration Tests - Real tests for complete system integration
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
const TEST_DB = path.join(__dirname, 'integration-test.sqlite');
const TEST_PROJECT_DIR = path.join(__dirname, 'test-project');

function cleanupTest() {
  // Clean up test database
  if (fs.existsSync(TEST_DB)) {
    fs.unlinkSync(TEST_DB);
  }
  
  // Clean up test project directory
  if (fs.existsSync(TEST_PROJECT_DIR)) {
    fs.rmSync(TEST_PROJECT_DIR, { recursive: true, force: true });
  }
}

function createTestProject() {
  // Create test project structure
  fs.mkdirSync(TEST_PROJECT_DIR, { recursive: true });
  fs.mkdirSync(path.join(TEST_PROJECT_DIR, 'src'), { recursive: true });
  fs.mkdirSync(path.join(TEST_PROJECT_DIR, 'docs'), { recursive: true });
  
  // Create test files
  fs.writeFileSync(path.join(TEST_PROJECT_DIR, 'README.md'), '# Test Project\n\nThis is a test project.');
  fs.writeFileSync(path.join(TEST_PROJECT_DIR, 'package.json'), '{\n  "name": "test-project",\n  "version": "1.0.0"\n}');
  fs.writeFileSync(path.join(TEST_PROJECT_DIR, 'src', 'index.js'), 'console.log("Hello, World!");');
  fs.writeFileSync(path.join(TEST_PROJECT_DIR, 'src', 'utils.js'), 'function add(a, b) {\n  return a + b;\n}\n\nmodule.exports = { add };');
  fs.writeFileSync(path.join(TEST_PROJECT_DIR, 'docs', 'api.md'), '# API Documentation\n\n## Functions\n\n### add(a, b)\nAdds two numbers.');
  
  // Create a binary file (fake image)
  const binaryData = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]); // PNG header
  fs.writeFileSync(path.join(TEST_PROJECT_DIR, 'logo.png'), binaryData);
}

function testCompleteWorkflow() {
  console.log('Testing complete VCS workflow...');
  
  cleanupTest();
  createTestProject();
  
  const repo = new MiniRepo(TEST_DB);
  repo.setAuthor('Test User', 'test@example.com');
  
  // Step 1: Add project directory
  const addResult = repo.addDirectory(TEST_PROJECT_DIR);
  assert(addResult.added === 6, 'Should add 6 files');
  assert(addResult.skipped === 0, 'Should skip 0 files');
  
  const files = repo.listFiles();
  assert(files.length === 6, 'Should have 6 files in working directory');
  
  // Verify specific files are present
  const projectName = path.basename(TEST_PROJECT_DIR);
  const expectedFiles = [
    `${projectName}/README.md`,
    `${projectName}/package.json`,
    `${projectName}/src/index.js`,
    `${projectName}/src/utils.js`,
    `${projectName}/docs/api.md`,
    `${projectName}/logo.png`
  ];
  
  expectedFiles.forEach(expectedFile => {
    assert(files.includes(expectedFile), `Should include ${expectedFile}`);
  });
  
  // Step 2: Create initial commit
  const commit1 = repo.commit('Initial project commit', 'Developer');
  assert(typeof commit1 === 'object', 'Should create commit result');
  assert(typeof commit1.commitHash === 'string', 'Should have commit hash');
  
  const history1 = repo.log();
  assert(history1.length === 1, 'Should have 1 commit');
  assert(history1[0].message === 'Initial project commit', 'Commit message should match');
  
  // Step 3: Create feature branch
  repo.createBranch('feature/add-tests');
  repo.switchBranch('feature/add-tests');
  assert(repo.getCurrentBranch() === 'feature/add-tests', 'Should be on feature branch');
  
  // Step 4: Add test files on feature branch
  repo.addFile(`${projectName}/test/utils.test.js`, 'const { add } = require("../src/utils");\n\nconsole.log("Testing add function...");\nconsole.log(add(2, 3) === 5 ? "PASS" : "FAIL");');
  repo.addFile(`${projectName}/test/index.test.js`, 'console.log("Main tests go here");');
  
  const featureFiles = repo.listFiles();
  assert(featureFiles.length === 2, 'Should have 2 newly staged files');
  
  const featureCommit = repo.commit('Add test files', 'Developer');
  
  // After commit, should have all 8 files from current commit
  const filesAfterCommit = repo.listFiles();
  assert(filesAfterCommit.length === 8, 'Feature branch should have 8 files after commit');
  
  // Step 5: Switch back to main and verify isolation
  repo.switchBranch('main');
  const mainFiles = repo.listFiles();
  assert(mainFiles.length === 6, 'Main branch should still have 6 files');
  assert(!mainFiles.some(f => f.includes('test/')), 'Main should not have test files');
  
  // Step 6: Make changes on main branch
  const updatedReadme = '# Test Project\n\nThis is a test project.\n\n## Installation\n\nnpm install';
  repo.addFile(`${projectName}/README.md`, updatedReadme);
  const mainCommit2 = repo.commit('Update README', 'Developer');
  
  // Step 7: Test diff between branches
  const branchDiff = repo.diffCommits(commit1.commitHash, featureCommit.commitHash);
  const addedFiles = branchDiff.filter(d => d.type === 'added');
  assert(addedFiles.length === 2, 'Should show 2 added test files');
  
  // Step 8: Test complete history
  repo.switchBranch('feature/add-tests');
  const featureHistory = repo.log(10);
  assert(featureHistory.length === 2, 'Feature branch should have 2 commits');
  
  repo.switchBranch('main');
  const mainHistory = repo.log(10);
  assert(mainHistory.length === 2, 'Main branch should have 2 commits');
  
  console.log('✅ Complete workflow tests passed');
}

function testBinaryHandling() {
  console.log('Testing binary file handling...');
  
  cleanupTest();
  const repo = new MiniRepo(TEST_DB);
  repo.setAuthor('Test User', 'test@example.com');
  
  // Add various file types
  repo.addFile('text.txt', 'This is plain text');
  repo.addFile('json.json', '{"key": "value", "number": 42}');
  repo.addFile('code.js', 'function hello() {\n  console.log("Hello!");\n}');
  
  // Add binary files
  const pngData = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  repo.addFile('image.png', pngData, true); // Force binary
  
  const jpegData = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0]);
  repo.addFile('photo.jpg', jpegData);
  
  // Mixed binary data
  const mixedData = new Uint8Array(100);
  for (let i = 0; i < 100; i++) {
    mixedData[i] = i % 256;
  }
  repo.addFile('mixed.bin', mixedData);
  
  const commit1 = repo.commit('Add various file types', 'Developer');
  
  // Test diffing between text and binary
  repo.addFile('text.txt', 'Updated text content');
  repo.addFile('image.png', new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0xFF])); // Modified binary
  
  const commit2 = repo.commit('Update files', 'Developer');
  
  const diff = repo.diffCommits(commit1.commitHash, commit2.commitHash);
  const textDiff = diff.find(d => d.file === 'text.txt');
  const binaryDiff = diff.find(d => d.file === 'image.png');

  assert(textDiff.type === 'modified', 'Text file should be modified');
  assert(textDiff.diff.includes('- This is plain text'), 'Should show text diff');
  assert(textDiff.diff.includes('+ Updated text content'), 'Should show text diff');

  assert(binaryDiff.type === 'modified', 'Binary file should be modified');
  assert(binaryDiff.diff.includes('Binary files differ'), 'Should indicate binary diff');
  
  console.log('✅ Binary handling tests passed');
}

function testLargeProject() {
  console.log('Testing large project simulation...');
  
  cleanupTest();
  const repo = new MiniRepo(TEST_DB);
  repo.setAuthor('Test User', 'test@example.com');
  
  // Simulate a larger project
  const files = [];
  for (let i = 1; i <= 50; i++) {
    const content = `// File ${i}\nfunction func${i}() {\n  return ${i};\n}\n\nmodule.exports = { func${i} };`;
    repo.addFile(`src/module${i}.js`, content);
    files.push(`src/module${i}.js`);
  }
  
  // Add some configuration files
  repo.addFile('.gitignore', 'node_modules/\n*.log\n.env');
  repo.addFile('package.json', JSON.stringify({
    name: 'large-project',
    version: '1.0.0',
    dependencies: {},
    scripts: { test: 'echo "test"' }
  }, null, 2));
  
  const initialFiles = repo.listFiles();
  assert(initialFiles.length === 52, 'Should have 52 files');
  
  const commit1 = repo.commit('Initial large project', 'Developer');
  
  // Test status after commit - working directory should be empty
  const status = repo.status();
  assert(status.staged.length === 0, 'Git-like behavior: working directory clears after commit');
  assert(typeof status.store_objects === 'number', 'Should track object count');
  
  // Modify multiple files
  for (let i = 1; i <= 10; i++) {
    const updatedContent = `// File ${i} - Updated\nfunction func${i}() {\n  return ${i} * 2;\n}\n\nmodule.exports = { func${i} };`;
    repo.addFile(`src/module${i}.js`, updatedContent);
  }
  
  const commit2 = repo.commit('Update first 10 modules', 'Developer');
  
  // Test diff on large changeset
  const largeDiff = repo.diffCommits(commit1.commitHash, commit2.commitHash);
  const modifiedFiles = largeDiff.filter(d => d.type === 'modified');
  assert(modifiedFiles.length === 10, 'Should show 10 modified files');
  
  // Test performance of history retrieval
  const startTime = Date.now();
  const history = repo.log(10);
  const endTime = Date.now();
  
  assert(history.length === 2, 'Should have 2 commits');
  assert(endTime - startTime < 1000, 'History retrieval should be fast'); // Less than 1 second
  
  console.log('✅ Large project tests passed');
}

function testBranchMergeScenario() {
  console.log('Testing branch merge scenario...');
  
  cleanupTest();
  const repo = new MiniRepo(TEST_DB);
  repo.setAuthor('Test User', 'test@example.com');
  
  // Create initial project state
  repo.addFile('main.js', 'console.log("Main application");');
  repo.addFile('config.json', '{"env": "development"}');
  const mainCommit = repo.commit('Initial main', 'Developer');
  
  // Create and switch to feature branch
  repo.createBranch('feature/auth');
  repo.switchBranch('feature/auth');
  
  // Add authentication features
  repo.addFile('auth.js', 'function authenticate(token) {\n  return token === "valid";\n}');
  repo.addFile('middleware.js', 'function authMiddleware(req, res, next) {\n  // Auth logic\n  next();\n}');
  const authCommit = repo.commit('Add authentication', 'Developer');
  
  // Switch back to main and make parallel changes
  repo.switchBranch('main');
  repo.addFile('utils.js', 'function formatDate(date) {\n  return date.toISOString();\n}');
  const updatedConfig = '{"env": "production", "debug": false}';
  repo.addFile('config.json', updatedConfig);
  const mainCommit2 = repo.commit('Add utils and update config', 'Developer');
  
  // Test that branches have diverged - need to checkout to see committed files
  repo.checkout(mainCommit2.commitHash);
  const mainFiles = repo.listFiles();
  const mainFileNames = mainFiles.map(f => path.basename(f));
  assert(mainFileNames.includes('utils.js'), 'Main should have utils.js');
  assert(!mainFileNames.includes('auth.js'), 'Main should not have auth.js');
  
  repo.switchBranch('feature/auth');
  repo.checkout(authCommit.commitHash);
  const authFiles = repo.listFiles();
  const authFileNames = authFiles.map(f => path.basename(f));
  assert(authFileNames.includes('auth.js'), 'Auth branch should have auth.js');
  assert(!authFileNames.includes('utils.js'), 'Auth branch should not have utils.js');
  
  // Test diff between diverged branches
  const divergenceDiff = repo.diffCommits(mainCommit2.commitHash, authCommit.commitHash);
  assert(divergenceDiff.length > 0, 'Should show differences between branches');
  
  // Verify both branches maintain their commit history
  repo.switchBranch('main');
  const mainHistory = repo.log();
  assert(mainHistory.length === 2, 'Main should have 2 commits');
  
  repo.switchBranch('feature/auth');
  const authHistory = repo.log();
  assert(authHistory.length === 2, 'Auth branch should have 2 commits');
  
  // Verify common ancestor
  assert(mainHistory[1].hash === authHistory[1].hash, 'Should have common initial commit');
  
  console.log('✅ Branch merge scenario tests passed');
}

function testDataIntegrity() {
  console.log('Testing data integrity...');
  
  cleanupTest();
  const repo = new MiniRepo(TEST_DB);
  repo.setAuthor('Test User', 'test@example.com');
  
  // Add files with various content patterns
  const testCases = [
    { name: 'empty.txt', content: '' },
    { name: 'single-line.txt', content: 'Single line' },
    { name: 'multi-line.txt', content: 'Line 1\nLine 2\nLine 3' },
    { name: 'unicode.txt', content: 'Hello 世界! 🌍 Ñoño 🦄' },
    { name: 'special-chars.txt', content: 'Special: !@#$%^&*()_+-=[]{}|;:"\',.<>?/`~' },
    { name: 'binary.bin', content: new Uint8Array([0, 1, 2, 255, 254, 253]) }
  ];
  
  testCases.forEach(({ name, content }) => {
    repo.addFile(name, content);
  });
  
  const commit1 = repo.commit('Add diverse content', 'Developer');
  
  // Checkout to retrieve files (working directory cleared after commit)
  repo.checkout(commit1.commitHash);
  
  // Verify all files can be retrieved correctly
  testCases.forEach(({ name, content }) => {
    const retrieved = repo.getFile(name);
    
    if (typeof content === 'string') {
      const retrievedText = new TextDecoder().decode(retrieved);
      assert(retrievedText === content, `String content should match for ${name}`);
    } else {
      assert(retrieved.length === content.length, `Binary length should match for ${name}`);
      assert(retrieved.every((byte, i) => byte === content[i]), `Binary content should match for ${name}`);
    }
  });
  
  // Test checkout and data persistence
  repo.addFile('new-file.txt', 'New content');
  const commit2 = repo.commit('Add new file', 'Developer');
  
  // Checkout previous commit
  repo.checkout(commit1.commitHash);
  
  // Verify original data is intact
  testCases.forEach(({ name, content }) => {
    const retrieved = repo.getFile(name);
    
    if (typeof content === 'string') {
      const retrievedText = new TextDecoder().decode(retrieved);
      assert(retrievedText === content, `Checked out content should match for ${name}`);
    } else {
      assert(retrieved.every((byte, i) => byte === content[i]), `Checked out binary should match for ${name}`);
    }
  });
  
  // Ensure new file is not present in old commit
  const oldFiles = repo.listFiles();
  assert(!oldFiles.includes('new-file.txt'), 'New file should not be in old commit');
  
  console.log('✅ Data integrity tests passed');
}

function testCompleteWorkflowWithDiskCheckout() {
  console.log('Testing complete workflow with disk checkout...');
  
  cleanupTest();
  createTestProject();
  
  const repo = new MiniRepo(TEST_DB);
  repo.setAuthor('Test User', 'test@example.com');
  
  // Add the test project
  const addResult = repo.addDirectory(TEST_PROJECT_DIR);
  assert(addResult.added === 6, 'Should add 6 files');
  
  const initialCommit = repo.commit('Initial project with nested structure', 'Integration Tester');
  
  // Create feature branch with more nested files
  repo.createBranch('feature/deep-structure');
  repo.switchBranch('feature/deep-structure');
  
  const projectName = path.basename(TEST_PROJECT_DIR);
  
  // Add deeply nested files
  repo.addFile(`${projectName}/src/components/Header.js`, 'export default function Header() { return <h1>Header</h1>; }');
  repo.addFile(`${projectName}/src/components/Footer.js`, 'export default function Footer() { return <footer>Footer</footer>; }');
  repo.addFile(`${projectName}/src/utils/constants.js`, 'export const API_URL = "https://api.example.com";');
  repo.addFile(`${projectName}/tests/unit/components/Header.test.js`, 'test("Header renders", () => {});');
  repo.addFile(`${projectName}/tests/integration/api.test.js`, 'test("API integration", () => {});');
  repo.addFile(`${projectName}/config/environments/development.json`, '{"debug": true, "apiUrl": "localhost"}');
  repo.addFile(`${projectName}/config/environments/production.json`, '{"debug": false, "apiUrl": "api.prod.com"}');
  repo.addFile(`${projectName}/docs/development/setup.md`, '# Development Setup\n\n## Prerequisites\n\n1. Node.js');
  
  const featureCommit = repo.commit('Add complex nested structure', 'Integration Tester');
  
  // Create checkout test directory
  const checkoutTestDir = path.join(__dirname, 'integration-checkout-test');
  const originalCwd = process.cwd();
  
  try {
    fs.mkdirSync(checkoutTestDir, { recursive: true });
    process.chdir(checkoutTestDir);
    
    // Test 1: Checkout feature branch to disk
    repo.checkout(featureCommit.commitHash, null, true);
    
    // Verify all files and directories exist
    const expectedFiles = [
      `${projectName}/README.md`,
      `${projectName}/package.json`,
      `${projectName}/src/index.js`,
      `${projectName}/src/utils.js`,
      `${projectName}/src/components/Header.js`,
      `${projectName}/src/components/Footer.js`,
      `${projectName}/src/utils/constants.js`,
      `${projectName}/docs/api.md`,
      `${projectName}/docs/development/setup.md`,
      `${projectName}/tests/unit/components/Header.test.js`,
      `${projectName}/tests/integration/api.test.js`,
      `${projectName}/config/environments/development.json`,
      `${projectName}/config/environments/production.json`,
      `${projectName}/logo.png`
    ];
    
    expectedFiles.forEach(filePath => {
      assert(fs.existsSync(filePath), `${filePath} should exist on disk`);
    });
    
    // Verify directories were created correctly
    const expectedDirs = [
      `${projectName}`,
      `${projectName}/src`,
      `${projectName}/src/components`,
      `${projectName}/src/utils`,
      `${projectName}/docs`,
      `${projectName}/docs/development`,
      `${projectName}/tests`,
      `${projectName}/tests/unit`,
      `${projectName}/tests/unit/components`,
      `${projectName}/tests/integration`,
      `${projectName}/config`,
      `${projectName}/config/environments`
    ];
    
    expectedDirs.forEach(dirPath => {
      assert(fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory(), 
             `${dirPath} should exist and be a directory`);
    });
    
    // Verify file contents
    const headerContent = fs.readFileSync(`${projectName}/src/components/Header.js`, 'utf8');
    assert(headerContent === 'export default function Header() { return <h1>Header</h1>; }', 
           'Header component content should match');
    
    const setupContent = fs.readFileSync(`${projectName}/docs/development/setup.md`, 'utf8');
    assert(setupContent === '# Development Setup\n\n## Prerequisites\n\n1. Node.js', 
           'Setup docs content should match');
    
    // Test 2: Switch to main branch and checkout
    repo.switchBranch('main');
    
    // Clear the checkout directory
    fs.readdirSync('.').forEach(item => {
      const itemPath = path.join('.', item);
      if (fs.statSync(itemPath).isDirectory()) {
        fs.rmSync(itemPath, { recursive: true });
      } else {
        fs.unlinkSync(itemPath);
      }
    });
    
    // Checkout main branch
    repo.checkout(initialCommit.commitHash, null, true);
    
    // Verify main branch has fewer files
    const mainFiles = fs.readdirSync(projectName, { recursive: true });
    const featureOnlyFiles = [
      'src/components/Header.js',
      'src/components/Footer.js', 
      'src/utils/constants.js',
      'tests/unit/components/Header.test.js',
      'tests/integration/api.test.js',
      'config/environments/development.json',
      'config/environments/production.json',
      'docs/development/setup.md'
    ];
    
    featureOnlyFiles.forEach(filePath => {
      assert(!fs.existsSync(`${projectName}/${filePath}`), 
             `Feature file ${filePath} should not exist in main branch`);
    });
    
    // Test 3: Checkout back to feature branch and verify everything returns
    repo.switchBranch('feature/deep-structure');
    
    // Clear again
    fs.readdirSync('.').forEach(item => {
      const itemPath = path.join('.', item);
      if (fs.statSync(itemPath).isDirectory()) {
        fs.rmSync(itemPath, { recursive: true });
      } else {
        fs.unlinkSync(itemPath);
      }
    });
    
    // Final checkout
    repo.checkout(featureCommit.commitHash, null, true);
    
    // Verify all feature files are back
    expectedFiles.forEach(filePath => {
      assert(fs.existsSync(filePath), `${filePath} should exist after switching back`);
    });
    
  } finally {
    process.chdir(originalCwd);
    
    // Clean up checkout test directory
    if (fs.existsSync(checkoutTestDir)) {
      fs.rmSync(checkoutTestDir, { recursive: true, force: true });
    }
  }
  
  console.log('✅ Complete workflow with disk checkout tests passed');
}

// Run all integration tests
function runIntegrationTests() {
  console.log('Running Integration Tests...\n');
  
  try {
    testCompleteWorkflow();
    testBinaryHandling();
    testLargeProject();
    testBranchMergeScenario();
    testDataIntegrity();
    testCompleteWorkflowWithDiskCheckout();
    
    console.log('\n✅ All integration tests passed!');
    return true;
  } catch (error) {
    console.error(`\n❌ Integration test failed: ${error.message}`);
    console.error(error.stack);
    return false;
  } finally {
    // Clean up test files
    cleanupTest();
  }
}

// Export for use by other test files
module.exports = { runIntegrationTests };

// Run tests if called directly
if (require.main === module) {
  process.exit(runIntegrationTests() ? 0 : 1);
}