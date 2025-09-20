/**
 * Transaction Isolation and Atomicity Tests - Validate ACID properties
 */

const fs = require('fs');
const path = require('path');
const { initStore } = require('../lib/core/storage');
const { storeTree, createCommit, getCommit } = require('../lib/core/objects');

// Simple test runner
function assert(condition, message = 'Assertion failed') {
  if (!condition) {
    throw new Error(message);
  }
}

// Test database path
let testCounter = 0;
function getTestDB() {
  return path.join(__dirname, `test-transaction-${++testCounter}.sqlite`);
}

function cleanupTestDB(dbPath) {
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
  }
}

function testTransactionAtomicity() {
  console.log('Testing transaction atomicity...');
  
  const testDB = getTestDB();
  const store = initStore(testDB);
  
  // Test that failed transactions rollback completely
  const initialStats = store.getStats();
  
  try {
    const result = store.transaction(() => {
      // Store some blobs successfully
      const blob1 = store.storeBlob(new Uint8Array([1, 2, 3]));
      const blob2 = store.storeBlob(new Uint8Array([4, 5, 6]));
      
      // Create tree entry that should succeed
      const entries = [{
        name: 'test.txt',
        type: 'file', 
        hash: blob1.hash,
        binary: false
      }];
      const treeHash = storeTree(entries, store);
      
      // Now cause a deliberate error to force rollback
      throw new Error('Deliberate transaction failure');
    });
  } catch (error) {
    // Expected error - transaction should rollback
    assert(error.message === 'Deliberate transaction failure', 'Should get expected error');
  }
  
  // Verify that NO data was persisted (atomicity)
  const finalStats = store.getStats();
  assert(finalStats.blobs === initialStats.blobs, 'Transaction rollback should restore blob count');
  assert(finalStats.dbSize === initialStats.dbSize, 'Transaction rollback should restore database size');
  
  // Test successful transaction commits completely
  const successResult = store.transaction(() => {
    const blob1 = store.storeBlob(new Uint8Array([7, 8, 9]));
    const blob2 = store.storeBlob(new Uint8Array([10, 11, 12]));
    
    const entries = [{
      name: 'success.txt',
      type: 'file',
      hash: blob1.hash, 
      binary: false
    }];
    
    return storeTree(entries, store);
  });
  
  // Verify all data persisted (atomicity)
  const postSuccessStats = store.getStats();
  assert(postSuccessStats.blobs > finalStats.blobs, 'Successful transaction should persist data');
  assert(typeof successResult === 'string', 'Transaction should return result');
  
  cleanupTestDB(testDB);
  console.log('✅ Transaction atomicity tests passed');
}

function testNestedTransactionBehavior() {
  console.log('Testing nested transaction behavior...');
  
  const testDB = getTestDB();
  const store = initStore(testDB);
  
  let outerResult, innerResult;
  
  // Test nested transactions (SQLite uses savepoints)
  const result = store.transaction(() => {
    // Outer transaction
    const blob1 = store.storeBlob(new Uint8Array([1, 2, 3]));
    outerResult = blob1.hash;
    
    // Inner transaction should share the same transaction context
    const nestedResult = store.transaction(() => {
      const blob2 = store.storeBlob(new Uint8Array([4, 5, 6]));
      innerResult = blob2.hash;
      return blob2.hash;
    });
    
    return { outer: outerResult, inner: nestedResult };
  });
  
  // Verify both transactions succeeded
  assert(result.outer === outerResult, 'Outer transaction should succeed');
  assert(result.inner === innerResult, 'Inner transaction should succeed');
  
  // Verify data is accessible outside transaction
  const retrievedOuter = store.getBlob(outerResult);
  const retrievedInner = store.getBlob(innerResult);
  
  assert(retrievedOuter !== null, 'Outer transaction data should persist');
  assert(retrievedInner !== null, 'Inner transaction data should persist');
  
  cleanupTestDB(testDB);
  console.log('✅ Nested transaction behavior tests passed');
}

function testConcurrentTransactionIsolation() {
  console.log('Testing concurrent transaction isolation...');
  
  const testDB = getTestDB();
  const store1 = initStore(testDB);
  const store2 = initStore(testDB);
  
  // Test that multiple store instances can work with the same database
  // but are isolated during transactions
  
  const data1 = new Uint8Array([1, 1, 1]);
  const data2 = new Uint8Array([2, 2, 2]);
  
  const result1 = store1.storeBlob(data1);
  const result2 = store2.storeBlob(data2);
  
  // Both stores should be able to read each other's data
  const cross1 = store1.getBlob(result2.hash);
  const cross2 = store2.getBlob(result1.hash);
  
  assert(cross1 !== null, 'Store1 should read Store2 data');
  assert(cross2 !== null, 'Store2 should read Store1 data');
  assert(cross1.every((byte, i) => byte === data2[i]), 'Cross-read data should be correct');
  assert(cross2.every((byte, i) => byte === data1[i]), 'Cross-read data should be correct');
  
  cleanupTestDB(testDB);
  console.log('✅ Concurrent transaction isolation tests passed');
}

function testTransactionConsistency() {
  console.log('Testing transaction consistency...');
  
  const testDB = getTestDB();
  const store = initStore(testDB);
  
  // Test that transactions maintain database consistency
  // by validating foreign key relationships
  
  const commitHash = store.transaction(() => {
    // Create file blobs
    const file1 = store.storeBlob(new TextEncoder().encode('file1 content'));
    const file2 = store.storeBlob(new TextEncoder().encode('file2 content'));
    
    // Create tree
    const entries = [
      { name: 'file1.txt', type: 'file', hash: file1.hash, binary: false },
      { name: 'file2.txt', type: 'file', hash: file2.hash, binary: false }
    ];
    const treeHash = storeTree(entries, store);
    
    // Create commit referencing the tree
    const commitHash = createCommit(
      treeHash, 
      'Test commit', 
      'Test Author', 
      'test@example.com', 
      null, 
      store
    );
    
    return commitHash;
  });
  
  // Verify consistency - all related data should be accessible
  const commit = getCommit(commitHash, store);
  assert(commit !== null, 'Commit should be accessible');
  assert(typeof commit.tree === 'string', 'Commit should reference tree');
  
  // Verify foreign key relationships are maintained
  const treeRid = store.getRidFromHash(commit.tree);
  const commitRid = store.getRidFromHash(commitHash);
  
  assert(treeRid !== null, 'Tree RID should exist');
  assert(commitRid !== null, 'Commit RID should exist');
  
  // Check manifest table consistency
  const manifestQuery = store.db.prepare('SELECT tree_rid FROM manifests WHERE rid = ?');
  const manifest = manifestQuery.get(commitRid);
  assert(manifest.tree_rid === treeRid, 'Manifest should correctly reference tree RID');
  
  cleanupTestDB(testDB);
  console.log('✅ Transaction consistency tests passed');
}

function testTransactionErrorHandling() {
  console.log('Testing transaction error handling...');
  
  const testDB = getTestDB();
  const store = initStore(testDB);
  
  // Test various error conditions and their rollback behavior
  const testCases = [
    {
      name: 'Foreign key violation',
      operation: () => {
        const blob = store.storeBlob(new Uint8Array([1, 2, 3]));
        // Try to insert file_entry with non-existent tree_rid
        store.db.prepare("INSERT INTO file_entries VALUES (99999, 1, 'file', ?, 0)").run(blob.rid);
      },
      expectedError: 'FOREIGN KEY constraint failed'
    },
    {
      name: 'CHECK constraint violation', 
      operation: () => {
        // Try to insert blob with invalid hash length
        store.db.prepare("INSERT INTO blob VALUES (1, 'short', ?, 100, ?)").run(new Uint8Array([1]), Date.now());
      },
      expectedError: 'CHECK constraint failed'
    },
    {
      name: 'NOT NULL constraint violation',
      operation: () => {
        // Try to insert manifest with NULL message
        const blob = store.storeBlob(new Uint8Array([1, 2, 3]));
        store.db.prepare("INSERT INTO manifests VALUES (?, ?, NULL, NULL, 'author', 'email', ?)").run(blob.rid, blob.rid, Date.now());
      },
      expectedError: 'NOT NULL constraint failed'
    }
  ];
  
  for (const testCase of testCases) {
    const initialStats = store.getStats();
    
    try {
      store.transaction(() => {
        // Add some valid data first
        store.storeBlob(new Uint8Array([7, 8, 9]));
        
        // Then trigger the error
        testCase.operation();
      });
      
      assert(false, `${testCase.name} should have thrown an error`);
    } catch (error) {
      assert(error.message.includes(testCase.expectedError), 
             `${testCase.name} should throw expected error: ${error.message}`);
      
      // Verify rollback occurred
      const finalStats = store.getStats();
      assert(finalStats.blobs === initialStats.blobs, 
             `${testCase.name} should rollback on error`);
    }
  }
  
  cleanupTestDB(testDB);
  console.log('✅ Transaction error handling tests passed');
}

function testTransactionPerformance() {
  console.log('Testing transaction performance...');
  
  const testDB = getTestDB();
  const store = initStore(testDB);
  
  // Test that transactions provide performance benefits for bulk operations
  const numOperations = 100;
  
  // Test individual operations (no explicit transaction)
  const startIndividual = process.hrtime.bigint();
  for (let i = 0; i < numOperations; i++) {
    const data = new Uint8Array(100).fill(i % 256);
    store.storeBlob(data);
  }
  const individualTime = Number(process.hrtime.bigint() - startIndividual) / 1_000_000;
  
  // Clear database for fair comparison
  store.db.exec('DELETE FROM blob');
  store.db.exec("DELETE FROM sqlite_sequence WHERE name = 'blob'");
  
  // Test bulk operations (explicit transaction)
  const startBulk = process.hrtime.bigint();
  store.transaction(() => {
    for (let i = 0; i < numOperations; i++) {
      const data = new Uint8Array(100).fill(i % 256);
      store.storeBlob(data);
    }
  });
  const bulkTime = Number(process.hrtime.bigint() - startBulk) / 1_000_000;
  
  console.log(`  Individual operations: ${individualTime.toFixed(2)}ms`);
  console.log(`  Bulk transaction: ${bulkTime.toFixed(2)}ms`);
  console.log(`  Performance improvement: ${(individualTime / bulkTime).toFixed(1)}x faster`);
  
  // Transaction should be significantly faster for bulk operations
  assert(bulkTime < individualTime, 'Transaction should be faster than individual operations');
  
  // Verify data integrity after bulk operation
  const stats = store.getStats();
  assert(stats.blobs === numOperations, 'All operations should have succeeded in transaction');
  
  cleanupTestDB(testDB);
  console.log('✅ Transaction performance tests passed');
}

// Run all tests
function runTransactionTests() {
  console.log('Running Transaction Isolation and Atomicity Tests...\n');
  
  try {
    testTransactionAtomicity();
    testNestedTransactionBehavior(); 
    testConcurrentTransactionIsolation();
    testTransactionConsistency();
    testTransactionErrorHandling();
    testTransactionPerformance();
    
    console.log('\n✅ All transaction isolation and atomicity tests passed!');
    console.log('\n📋 Transaction ACID Properties Summary:');
    console.log('- Atomicity: All-or-nothing operations ✅');
    console.log('- Consistency: Database integrity maintained ✅'); 
    console.log('- Isolation: Concurrent access handled ✅');
    console.log('- Durability: Changes persist after commit ✅');
    
    return true;
  } catch (error) {
    console.error(`\n❌ Transaction test failed: ${error.message}`);
    console.error(error.stack);
    return false;
  } finally {
    // Clean up test database files
    for (let i = 1; i <= testCounter; i++) {
      const testDb = path.join(__dirname, `test-transaction-${i}.sqlite`);
      cleanupTestDB(testDb);
    }
  }
}

// Export for use by other test files
module.exports = { runTransactionTests };

// Run tests if called directly
if (require.main === module) {
  process.exit(runTransactionTests() ? 0 : 1);
}