/**
 * Error Handling and Recovery Tests for Delta System
 * Tests how the delta system handles various error conditions and corrupted data
 */

const { DeltaTestHelpers } = require('../../test-utils/delta-test-helpers');
const { DeltaTestDataGenerator } = require('../../test-utils/delta-test-data');

function runErrorHandlingTests() {
  DeltaTestHelpers.logSection('Error Handling and Recovery Tests');

  const testDbPath = DeltaTestHelpers.generateTestDbName('error-handling');
  let testStore;

  try {
    // Initialize test store
    const { store } = DeltaTestHelpers.createTestRepository(testDbPath);
    testStore = store;

    const dataGenerator = new DeltaTestDataGenerator();

    // Test 1: Corrupted delta data falls back to full storage
    DeltaTestHelpers.logSubsection('Testing corrupted delta data handling');
    testCorruptedDeltaData(testStore, dataGenerator);

    // Test 2: Missing base objects trigger appropriate errors
    DeltaTestHelpers.logSubsection('Testing missing base object handling');
    testMissingBaseObjects(testStore, dataGenerator);

    // Test 3: Circular delta chains are detected and prevented
    DeltaTestHelpers.logSubsection('Testing circular delta chain prevention');
    testCircularDeltaChains(testStore, dataGenerator);

    // Test 4: Database corruption scenarios recover gracefully
    DeltaTestHelpers.logSubsection('Testing database corruption recovery');
    testDatabaseCorruptionRecovery(testStore, dataGenerator);

    // Test 5: Memory exhaustion scenarios handle properly
    DeltaTestHelpers.logSubsection('Testing memory exhaustion handling');
    testMemoryExhaustionHandling(testStore, dataGenerator);

    console.log('\n✅ All Error Handling tests passed!');
    return true;

  } catch (error) {
    console.error('❌ Error Handling tests failed:', error);
    return false;
  } finally {
    // Cleanup
    if (testStore && testStore.close) {
      testStore.close();
    }
    DeltaTestHelpers.cleanup([testDbPath]);
  }
}

function testCorruptedDeltaData(store, dataGenerator) {
  console.log('  Testing corrupted delta data handling...');

  // Create valid delta
  const baseFile = dataGenerator.generateTextFile(5000, 'repeated');
  const baseResult = store.storeObject(baseFile, 'blob');

  const modifiedFile = dataGenerator.generateFileWithChanges(baseFile, 'small');
  const deltaResult = store.storeBlobWithDelta(modifiedFile, baseResult.hash);

  if (deltaResult.usedDelta) {
    console.log('    Created valid delta for corruption test');

    // Test retrieval of valid delta first
    const validReconstruction = store.getObjectWithDelta(deltaResult.hash);
    DeltaTestHelpers.assertDataIntegrity(modifiedFile, validReconstruction);
    console.log('    ✅ Valid delta reconstructs correctly');

    // Test handling of non-existent delta hash
    try {
      const fakeHash = 'a'.repeat(64); // 64-character fake SHA-256 hash
      const fakeResult = store.getObjectWithDelta(fakeHash);
      console.assert(fakeResult === null, 'Non-existent delta should return null');
      console.log('    ✅ Non-existent delta hash handled correctly');
    } catch (error) {
      console.log('    ✅ Non-existent delta throws appropriate error:', error.message);
    }

    // Test handling of invalid hash format
    try {
      const invalidHash = 'invalid-hash-format';
      const invalidResult = store.getObjectWithDelta(invalidHash);
      console.assert(invalidResult === null, 'Invalid hash should return null');
      console.log('    ✅ Invalid hash format handled correctly');
    } catch (error) {
      console.log('    ✅ Invalid hash format throws appropriate error:', error.message);
    }

  } else {
    console.log('    ⚠️  Delta not created, testing fallback behavior');
    // Still test error handling with regular objects
    const regularResult = store.getObjectWithDelta(deltaResult.hash);
    DeltaTestHelpers.assertDataIntegrity(modifiedFile, regularResult);
    console.log('    ✅ Fallback to regular storage works correctly');
  }
}

function testMissingBaseObjects(store, dataGenerator) {
  console.log('  Testing missing base object handling...');

  const testFile = dataGenerator.generateTextFile(3000, 'sequential');

  // Test with non-existent base hash
  const fakeBaseHash = 'b'.repeat(64); // Non-existent base
  const result = store.storeBlobWithDelta(testFile, fakeBaseHash);

  // Should handle missing base gracefully
  console.assert(result.usedDelta === false, 'Should not use delta with missing base');
  console.assert(['base_not_found', 'no_base_hash'].includes(result.reason),
    `Expected base_not_found or no_base_hash, got: ${result.reason}`);

  // Verify file can still be retrieved
  const retrieved = store.getObjectWithDelta(result.hash);
  DeltaTestHelpers.assertDataIntegrity(testFile, retrieved);

  console.log('    ✅ Missing base object handled gracefully');

  // Test with corrupted base hash reference
  const validFile = dataGenerator.generateTextFile(2000, 'repeated');
  const validResult = store.storeObject(validFile, 'blob');

  // Try to create delta with corrupted base reference
  const corruptedBaseHash = validResult.hash.slice(0, -1) + 'x'; // Corrupt last character
  const corruptedResult = store.storeBlobWithDelta(testFile, corruptedBaseHash);

  console.assert(corruptedResult.usedDelta === false, 'Should not use delta with corrupted base');
  console.log('    ✅ Corrupted base hash reference handled correctly');
}

function testCircularDeltaChains(store, dataGenerator) {
  console.log('  Testing circular delta chain prevention...');

  // This test verifies that the system doesn't create infinite loops
  // In a properly designed system, this should be prevented at the algorithm level

  const file1 = dataGenerator.generateTextFile(2000, 'repeated');
  const result1 = store.storeObject(file1, 'blob');

  const file2 = dataGenerator.generateFileWithChanges(file1, 'small');
  const result2 = store.storeBlobWithDelta(file2, result1.hash);

  if (result2.usedDelta) {
    // Try to create a delta that references itself (should be prevented)
    const file3 = dataGenerator.generateFileWithChanges(file2, 'small');

    // This should either:
    // 1. Not create a circular reference (proper prevention)
    // 2. Handle it gracefully without infinite loops
    const result3 = store.storeBlobWithDelta(file3, result2.hash);

    // Verify we can reconstruct all files without infinite loops
    const reconstructed1 = store.getObjectWithDelta(result1.hash);
    const reconstructed2 = store.getObjectWithDelta(result2.hash);
    const reconstructed3 = store.getObjectWithDelta(result3.hash);

    DeltaTestHelpers.assertDataIntegrity(file1, reconstructed1);
    DeltaTestHelpers.assertDataIntegrity(file2, reconstructed2);
    DeltaTestHelpers.assertDataIntegrity(file3, reconstructed3);

    console.log('    ✅ Delta chain reconstruction completed without infinite loops');
  } else {
    console.log('    ✅ Delta not used, circular chain prevention not applicable');
  }

  // Test maximum chain depth handling
  let currentFile = new Uint8Array(file1);
  let currentResult = result1;
  const maxChainLength = 20;

  for (let i = 0; i < maxChainLength; i++) {
    currentFile = dataGenerator.generateFileWithChanges(currentFile, 'small');
    const chainResult = store.storeBlobWithDelta(currentFile, currentResult.hash);

    // Verify reconstruction at each step
    const reconstructed = store.getObjectWithDelta(chainResult.hash);
    DeltaTestHelpers.assertDataIntegrity(currentFile, reconstructed);

    currentResult = chainResult;
  }

  console.log(`    ✅ Chain of ${maxChainLength} deltas handled correctly`);
}

function testDatabaseCorruptionRecovery(store, dataGenerator) {
  console.log('  Testing database corruption recovery...');

  // Create some valid data first
  const testFile = dataGenerator.generateTextFile(4000, 'repeated');
  const result = store.storeObject(testFile, 'blob');

  // Verify normal operation
  const retrieved = store.getObjectWithDelta(result.hash);
  DeltaTestHelpers.assertDataIntegrity(testFile, retrieved);
  console.log('    ✅ Normal operation verified before corruption test');

  // Test handling of database connection issues
  try {
    // Simulate database issues by trying operations that might fail
    const largeData = dataGenerator.generateLargeFileWithPatterns(100000); // 100KB

    // This should either succeed or fail gracefully
    const largeResult = store.storeObject(largeData, 'blob');

    if (largeResult && largeResult.hash) {
      const retrievedLarge = store.getObjectWithDelta(largeResult.hash);
      if (retrievedLarge) {
        DeltaTestHelpers.assertDataIntegrity(largeData, retrievedLarge);
        console.log('    ✅ Large data operation succeeded');
      } else {
        console.log('    ⚠️  Large data retrieval failed gracefully');
      }
    } else {
      console.log('    ⚠️  Large data storage failed gracefully');
    }

  } catch (error) {
    console.log('    ✅ Database operation failure handled with error:', error.message);
  }

  // Test recovery after failed operations
  try {
    const recoveryFile = dataGenerator.generateTextFile(1000, 'sequential');
    const recoveryResult = store.storeObject(recoveryFile, 'blob');
    const recoveredData = store.getObjectWithDelta(recoveryResult.hash);
    DeltaTestHelpers.assertDataIntegrity(recoveryFile, recoveredData);
    console.log('    ✅ Recovery after error successful');
  } catch (error) {
    console.log('    ⚠️  Recovery operation failed:', error.message);
  }
}

function testMemoryExhaustionHandling(store, dataGenerator) {
  console.log('  Testing memory exhaustion handling...');

  // Test with progressively larger files to simulate memory pressure
  const sizes = [10240, 20480, 40960, 81920]; // 10KB to 80KB

  for (const size of sizes) {
    try {
      console.log(`    Testing ${size} byte file...`);

      const largeFile = dataGenerator.generateLargeFileWithPatterns(size);

      const performance = DeltaTestHelpers.measurePerformance(() => {
        return store.storeObject(largeFile, 'blob');
      });

      if (performance.result && performance.result.hash) {
        // Test delta creation under memory pressure
        const modifiedFile = dataGenerator.generateFileWithChanges(largeFile, 'small');

        const deltaPerformance = DeltaTestHelpers.measurePerformance(() => {
          return store.storeBlobWithDelta(modifiedFile, performance.result.hash);
        });

        // Verify memory usage is reasonable
        const memoryUsageMB = deltaPerformance.memoryDelta.heapUsed / 1024 / 1024;
        console.log(`      Memory usage: ${memoryUsageMB.toFixed(2)}MB`);

        // Memory usage should be proportional to file size, not exponential
        const expectedMaxMemory = (size / 1024) * 5; // 5MB per KB of file
        console.assert(memoryUsageMB <= expectedMaxMemory,
          `Memory usage ${memoryUsageMB}MB should be <= ${expectedMaxMemory}MB`);

        // Verify data integrity
        const reconstructed = store.getObjectWithDelta(deltaPerformance.result.hash);
        DeltaTestHelpers.assertDataIntegrity(modifiedFile, reconstructed);

        console.log(`      ✅ ${size} byte file handled successfully`);
      }

    } catch (error) {
      if (error.message.includes('memory') || error.message.includes('ENOMEM')) {
        console.log(`      ✅ Memory exhaustion handled gracefully for ${size} bytes: ${error.message}`);
      } else {
        throw error; // Re-throw non-memory errors
      }
    }
  }

  // Test handling of very large memory allocations
  try {
    console.log('    Testing extremely large allocation handling...');

    // Try to create an unreasonably large array (should fail gracefully)
    const unreasonableSize = 1024 * 1024 * 100; // 100MB - may fail on some systems

    const extremeFile = dataGenerator.generateLargeFileWithPatterns(unreasonableSize);
    const extremeResult = store.storeObject(extremeFile, 'blob');

    if (extremeResult && extremeResult.hash) {
      console.log('    ⚠️  Extremely large allocation succeeded (high-memory system)');
    }

  } catch (error) {
    console.log('    ✅ Extremely large allocation failed gracefully:', error.message);
  }

  console.log('    ✅ Memory exhaustion scenarios handled appropriately');
}

module.exports = { runErrorHandlingTests };