/**
 * Test suite for v2 content-addressed storage system
 * Tests all core functionality before system replacement
 */

const assert = require('assert');
const { ContentAddressedStore } = require('../lib/core/storage-v2');
const {
  storeBlob,
  getBlob,
  storeTree,
  getTree,
  createCommit,
  getCommit,
  getCommitHistory,
  findMergeBase,
  getOptimizedCommitHistory,
  collectReachableObjects
} = require('../lib/core/objects-v2');
const OptimizedBranchTransfer = require('../lib/core/branch-transfer-v2');

// Test helper to create fresh in-memory store
function createStore() {
  return new ContentAddressedStore(':memory:');
}

// Test basic blob storage
function testBlobStorage() {
  console.log('Testing blob storage...');
  const store = createStore();

  // Store a blob
  const content = new TextEncoder().encode('Test content');
  const result = storeBlob(content, store);

  assert(result.hash, 'Blob should have hash');
  assert(result.isNew === true, 'First blob should be new');

  // Store same content again
  const result2 = storeBlob(content, store);
  assert(result2.hash === result.hash, 'Same content should have same hash');
  assert(result2.isNew === false, 'Duplicate blob should not be new');

  // Retrieve blob
  const retrieved = getBlob(result.hash, store);
  const text = new TextDecoder().decode(retrieved);
  assert(text === 'Test content', 'Retrieved content should match');

  // Try non-existent blob
  const notFound = getBlob('0'.repeat(64), store);
  assert(notFound === null, 'Non-existent blob should return null');

  store.close();
  console.log('  ✓ Blob storage tests passed');
}

// Test tree storage
function testTreeStorage() {
  console.log('Testing tree storage...');
  const store = createStore();

  // Create blobs for tree entries
  const blob1 = storeBlob(new TextEncoder().encode('File 1'), store);
  const blob2 = storeBlob(new TextEncoder().encode('File 2'), store);

  // Create tree
  const entries = [
    { name: 'file1.txt', type: 'file', hash: blob1.hash, mode: 100644, size: 6 },
    { name: 'file2.txt', type: 'file', hash: blob2.hash, mode: 100644, size: 6 },
    { name: 'subdir', type: 'dir', hash: '0'.repeat(64), mode: 40000 }
  ];

  const treeHash = storeTree(entries, store);
  assert(treeHash, 'Tree should have hash');

  // Retrieve tree
  const retrieved = getTree(treeHash, store);
  assert(retrieved.length === 3, 'Should have 3 entries');
  assert(retrieved[0].name === 'file1.txt', 'First entry name should match');
  assert(retrieved[0].hash === blob1.hash, 'First entry hash should match');

  // Test empty tree
  const emptyHash = storeTree([], store);
  const emptyTree = getTree(emptyHash, store);
  assert(emptyTree.length === 0, 'Empty tree should have no entries');

  store.close();
  console.log('  ✓ Tree storage tests passed');
}

// Test commit creation
function testCommitCreation() {
  console.log('Testing commit creation...');
  const store = createStore();

  // Create blob and tree for commit
  const blob = storeBlob(new TextEncoder().encode('Initial content'), store);
  const tree = storeTree([
    { name: 'readme.txt', type: 'file', hash: blob.hash, mode: 100644, size: 15 }
  ], store);

  // Create initial commit (no parent)
  const commit1 = createCommit(tree, 'Initial commit', 'Test User', 'test@example.com', null, store);
  assert(commit1, 'Commit should have hash');

  // Retrieve commit
  const retrieved = getCommit(commit1, store);
  assert(retrieved.message === 'Initial commit', 'Message should match');
  assert(retrieved.author === 'Test User', 'Author should match');
  assert(retrieved.tree === tree, 'Tree hash should match');
  assert(retrieved.parent === null, 'Should have no parent');

  // Create child commit
  const commit2 = createCommit(tree, 'Second commit', 'Test User', 'test@example.com', commit1, store);
  const retrieved2 = getCommit(commit2, store);
  assert(retrieved2.parent === commit1, 'Should have parent');

  store.close();
  console.log('  ✓ Commit creation tests passed');
}

// Test commit history
function testCommitHistory() {
  console.log('Testing commit history...');
  const store = createStore();

  // Create chain of commits
  const commits = [];
  let parent = null;

  for (let i = 0; i < 5; i++) {
    const blob = storeBlob(new TextEncoder().encode(`Content ${i}`), store);
    const tree = storeTree([
      { name: `file${i}.txt`, type: 'file', hash: blob.hash, mode: 100644, size: 10 }
    ], store);
    const commit = createCommit(tree, `Commit ${i}`, 'Test User', 'test@example.com', parent, store);
    commits.push(commit);
    parent = commit;
  }

  // Get history from latest
  const history = getCommitHistory(commits[4], 10, store);
  assert(history.length === 5, 'Should have 5 commits in history');
  assert(history[0].hash === commits[4], 'First should be latest');
  assert(history[4].hash === commits[0], 'Last should be oldest');

  // Test limited history
  const limited = getCommitHistory(commits[4], 3, store);
  assert(limited.length === 3, 'Should limit to 3 commits');

  store.close();
  console.log('  ✓ Commit history tests passed');
}

// Test branch references
function testBranchReferences() {
  console.log('Testing branch references...');
  const store = createStore();

  // Create a commit
  const blob = storeBlob(new TextEncoder().encode('Content'), store);
  const tree = storeTree([
    { name: 'file.txt', type: 'file', hash: blob.hash, mode: 100644, size: 7 }
  ], store);
  const commit = createCommit(tree, 'Test commit', 'Test User', 'test@example.com', null, store);

  // Set branch reference
  store.setRef('refs/heads/main', commit, 'branch');

  // Get reference
  const ref = store.getRef('refs/heads/main');
  assert(ref.hash === commit, 'Branch should point to commit');
  assert(ref.type === 'branch', 'Type should be branch');

  // Update reference
  const commit2 = createCommit(tree, 'Second commit', 'Test User', 'test@example.com', commit, store);
  store.setRef('refs/heads/main', commit2, 'branch');
  const updated = store.getRef('refs/heads/main');
  assert(updated.hash === commit2, 'Branch should update');

  // List references
  const refs = store.listRefs();
  assert(refs.length === 1, 'Should have one ref');
  assert(refs[0].name === 'refs/heads/main', 'Ref name should match');

  // Delete reference
  const deleted = store.removeRef('refs/heads/main');
  assert(deleted === true, 'Should delete ref');
  const gone = store.getRef('refs/heads/main');
  assert(gone === null, 'Deleted ref should not exist');

  store.close();
  console.log('  ✓ Branch reference tests passed');
}

// Test merge base detection
function testMergeBase() {
  console.log('Testing merge base detection...');
  const store = createStore();

  // Create common history
  const blob1 = storeBlob(new TextEncoder().encode('Base'), store);
  const tree1 = storeTree([
    { name: 'base.txt', type: 'file', hash: blob1.hash, mode: 100644, size: 4 }
  ], store);
  const base = createCommit(tree1, 'Base commit', 'Test User', 'test@example.com', null, store);

  // Create main branch commits
  const mainCommit1 = createCommit(tree1, 'Main 1', 'Test User', 'test@example.com', base, store);
  const mainCommit2 = createCommit(tree1, 'Main 2', 'Test User', 'test@example.com', mainCommit1, store);

  // Create feature branch commits
  const featureCommit1 = createCommit(tree1, 'Feature 1', 'Test User', 'test@example.com', base, store);
  const featureCommit2 = createCommit(tree1, 'Feature 2', 'Test User', 'test@example.com', featureCommit1, store);

  // Find merge base
  const mergeBase = findMergeBase(mainCommit2, featureCommit2, store);
  assert(mergeBase === base, 'Merge base should be common ancestor');

  store.close();
  console.log('  ✓ Merge base tests passed');
}

// Test optimized commit history
function testOptimizedHistory() {
  console.log('Testing optimized commit history...');
  const store = createStore();

  // Create common base
  const blob = storeBlob(new TextEncoder().encode('Base content'), store);
  const tree = storeTree([
    { name: 'base.txt', type: 'file', hash: blob.hash, mode: 100644, size: 12 }
  ], store);

  // Create common commits
  const base1 = createCommit(tree, 'Base 1', 'Test User', 'test@example.com', null, store);
  const base2 = createCommit(tree, 'Base 2', 'Test User', 'test@example.com', base1, store);

  // Create main branch commits from base2
  const mainBlob = storeBlob(new TextEncoder().encode('Main content'), store);
  const mainTree = storeTree([
    { name: 'base.txt', type: 'file', hash: blob.hash, mode: 100644, size: 12 },
    { name: 'main.txt', type: 'file', hash: mainBlob.hash, mode: 100644, size: 12 }
  ], store);
  const mainCommit1 = createCommit(mainTree, 'Main 1', 'Test User', 'test@example.com', base2, store);
  const mainCommit2 = createCommit(mainTree, 'Main 2', 'Test User', 'test@example.com', mainCommit1, store);

  // Create feature branch commits from base2 (divergent)
  const featureBlob = storeBlob(new TextEncoder().encode('Feature content'), store);
  const featureTree = storeTree([
    { name: 'base.txt', type: 'file', hash: blob.hash, mode: 100644, size: 12 },
    { name: 'feature.txt', type: 'file', hash: featureBlob.hash, mode: 100644, size: 15 }
  ], store);
  const featureCommit1 = createCommit(featureTree, 'Feature 1', 'Test User', 'test@example.com', base2, store);
  const featureCommit2 = createCommit(featureTree, 'Feature 2', 'Test User', 'test@example.com', featureCommit1, store);

  // Set up branches
  store.setRef('refs/heads/main', mainCommit2, 'branch');
  store.setRef('refs/heads/feature', featureCommit2, 'branch');

  // Get optimized history for feature branch
  const otherBranches = [mainCommit2]; // main branch head
  const optimized = getOptimizedCommitHistory(featureCommit2, otherBranches, store);

  // Should include feature commits plus merge base (base2)
  assert(optimized.length === 3, 'Should have 3 commits (2 feature + merge base)');
  assert(optimized[0].hash === featureCommit2, 'Should start with feature head');
  assert(optimized[optimized.length - 1].hash === base2, 'Should end with merge base');

  store.close();
  console.log('  ✓ Optimized history tests passed');
}

// Test reachable objects collection
function testReachableObjects() {
  console.log('Testing reachable objects collection...');
  const store = createStore();

  // Create objects
  const blob1 = storeBlob(new TextEncoder().encode('File 1'), store);
  const blob2 = storeBlob(new TextEncoder().encode('File 2'), store);
  const tree1 = storeTree([
    { name: 'file1.txt', type: 'file', hash: blob1.hash, mode: 100644, size: 6 }
  ], store);
  const tree2 = storeTree([
    { name: 'file1.txt', type: 'file', hash: blob1.hash, mode: 100644, size: 6 },
    { name: 'file2.txt', type: 'file', hash: blob2.hash, mode: 100644, size: 6 }
  ], store);
  const commit1 = createCommit(tree1, 'First', 'Test User', 'test@example.com', null, store);
  const commit2 = createCommit(tree2, 'Second', 'Test User', 'test@example.com', commit1, store);

  // Collect reachable from commit2
  const reachable = collectReachableObjects(commit2, store);

  // Should include: commit2, tree2, blob1, blob2, commit1, tree1
  assert(reachable.has(commit2), 'Should include commit2');
  assert(reachable.has(tree2), 'Should include tree2');
  assert(reachable.has(blob1.hash), 'Should include blob1');
  assert(reachable.has(blob2.hash), 'Should include blob2');
  assert(reachable.has(commit1), 'Should include parent commit');
  assert(reachable.has(tree1), 'Should include parent tree');
  assert(reachable.size === 6, 'Should have 6 reachable objects');

  store.close();
  console.log('  ✓ Reachable objects tests passed');
}

// Test branch export/import
function testBranchExportImport() {
  console.log('Testing branch export/import...');
  const store = createStore();

  // Create repository
  const blob = storeBlob(new TextEncoder().encode('Content'), store);
  const tree = storeTree([
    { name: 'file.txt', type: 'file', hash: blob.hash, mode: 100644, size: 7 }
  ], store);
  const commit = createCommit(tree, 'Test commit', 'Test User', 'test@example.com', null, store);
  store.setRef('refs/heads/test-branch', commit, 'branch');

  // Export branch
  const transfer = new OptimizedBranchTransfer(store);
  const exportData = transfer.exportBranch('test-branch');
  assert(exportData, 'Should export data');
  assert(exportData.length > 0, 'Export should have content');

  // Import to new store
  const store2 = createStore();
  const transfer2 = new OptimizedBranchTransfer(store2);
  const result = transfer2.importBranch(exportData);

  assert(result.branch === 'test-branch', 'Should import branch name');
  assert(result.objects_imported === 3, 'Should import 3 objects (commit, tree, blob)');

  // Verify imported data
  const importedRef = store2.getRef('refs/heads/test-branch');
  assert(importedRef.hash === commit, 'Imported branch should point to same commit');

  const importedCommit = getCommit(commit, store2);
  assert(importedCommit.message === 'Test commit', 'Imported commit should match');

  store.close();
  store2.close();
  console.log('  ✓ Branch export/import tests passed');
}

// Run all tests
function runAllTests() {
  console.log('\n=== V2 System Test Suite ===\n');

  try {
    testBlobStorage();
    testTreeStorage();
    testCommitCreation();
    testCommitHistory();
    testBranchReferences();
    testMergeBase();
    testOptimizedHistory();
    testReachableObjects();
    testBranchExportImport();

    console.log('\n✅ All v2 system tests passed!\n');
    return true;
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error.stack);
    return false;
  }
}

// Export for use by other test runners
module.exports = { runAllTests };

// Run tests if executed directly
if (require.main === module) {
  const success = runAllTests();
  process.exit(success ? 0 : 1);
}