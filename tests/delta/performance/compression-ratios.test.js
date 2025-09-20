/**
 * Delta Performance Validation Tests
 * Tests compression ratios, speed, and memory usage of delta functionality
 */

const { DeltaTestHelpers } = require('../../test-utils/delta-test-helpers');
const { DeltaTestDataGenerator } = require('../../test-utils/delta-test-data');

function runDeltaPerformanceTests() {
  DeltaTestHelpers.logSection('Delta Performance Validation Tests');

  const testDbPath = DeltaTestHelpers.generateTestDbName('performance');
  let testStore;

  try {
    // Initialize test store
    const { store } = DeltaTestHelpers.createTestRepository(testDbPath);
    testStore = store;

    const dataGenerator = new DeltaTestDataGenerator();

    // Test 1: Files >1KB achieve >50% compression ratio
    DeltaTestHelpers.logSubsection('Testing compression ratios for files >1KB');
    testCompressionRatios(testStore, dataGenerator);

    // Test 2: Delta creation completes within performance bounds
    DeltaTestHelpers.logSubsection('Testing delta creation performance');
    testDeltaCreationPerformance(testStore, dataGenerator);

    // Test 3: Delta reconstruction time is acceptable
    DeltaTestHelpers.logSubsection('Testing delta reconstruction performance');
    testDeltaReconstructionPerformance(testStore, dataGenerator);

    // Test 4: Memory usage stays within limits
    DeltaTestHelpers.logSubsection('Testing memory usage during compression');
    testMemoryUsage(testStore, dataGenerator);

    // Test 5: Large file chains remain performant
    DeltaTestHelpers.logSubsection('Testing performance with delta chains');
    testDeltaChainPerformance(testStore, dataGenerator);

    console.log('\n✅ All Performance Validation tests passed!');
    return true;

  } catch (error) {
    console.error('❌ Performance Validation tests failed:', error);
    return false;
  } finally {
    // Cleanup
    if (testStore && testStore.close) {
      testStore.close();
    }
    DeltaTestHelpers.cleanup([testDbPath]);
  }
}

function testCompressionRatios(store, dataGenerator) {
  const testCases = [
    { size: 2048, pattern: 'repeated', expectedRatio: 50, description: '2KB repeated pattern' },
    { size: 5120, pattern: 'sequential', expectedRatio: 40, description: '5KB sequential pattern' },
    { size: 10240, pattern: 'repeated', expectedRatio: 60, description: '10KB repeated pattern' }
  ];

  for (const testCase of testCases) {
    console.log(`  Testing ${testCase.description}...`);

    // Generate base file
    const baseFile = dataGenerator.generateTextFile(testCase.size, testCase.pattern);
    const baseResult = store.storeObject(baseFile, 'blob');

    // Generate file with small changes
    const modifiedFile = dataGenerator.generateFileWithChanges(baseFile, 'small');

    // Store with delta compression
    const deltaResult = store.storeBlobWithDelta(modifiedFile, baseResult.hash);

    if (deltaResult.usedDelta) {
      console.assert(deltaResult.compressionRatio >= testCase.expectedRatio,
        `Expected compression ratio >= ${testCase.expectedRatio}, got ${deltaResult.compressionRatio}`);

      console.log(`    ✅ Achieved ${(deltaResult.compressionRatio * 100).toFixed(1)}% compression ratio`);
      console.log(`    📊 Original: ${modifiedFile.length} bytes, Delta: ${deltaResult.deltaSize} bytes`);
    } else {
      console.log(`    ⚠️  Delta not used: ${deltaResult.reason}`);
      // For small files or binary data, delta might not be worthwhile
      console.assert(['file_too_small', 'insufficient_similarity', 'no_base_hash'].includes(deltaResult.reason),
        'Delta should not be used for valid reasons only');
    }
  }
}

function testDeltaCreationPerformance(store, dataGenerator) {
  const performanceBounds = {
    maxDuration: 5000, // 5 seconds for large files
    maxMemory: 50 * 1024 * 1024 // 50MB memory usage
  };

  // Test with progressively larger files
  const fileSizes = [5120, 10240, 20480, 40960]; // 5KB to 40KB

  for (const size of fileSizes) {
    console.log(`  Testing delta creation for ${size} byte file...`);

    const baseFile = dataGenerator.generateLargeFileWithPatterns(size);
    const baseResult = store.storeObject(baseFile, 'blob');

    const modifiedFile = dataGenerator.generateFileWithChanges(baseFile, 'small');

    // Measure delta creation performance
    const performance = DeltaTestHelpers.measurePerformance(() => {
      return store.storeBlobWithDelta(modifiedFile, baseResult.hash);
    });

    DeltaTestHelpers.logPerformanceMetrics(performance);

    // Adjust bounds based on file size
    const scaledBounds = {
      maxDuration: Math.max(1000, performanceBounds.maxDuration * (size / 40960)),
      maxMemory: performanceBounds.maxMemory
    };

    DeltaTestHelpers.assertPerformanceBounds(performance, scaledBounds);
    console.log(`    ✅ Delta creation for ${size} bytes within performance bounds`);
  }
}

function testDeltaReconstructionPerformance(store, dataGenerator) {
  const reconstructionBounds = {
    maxDuration: 2000, // 2 seconds for reconstruction
    maxMemory: 25 * 1024 * 1024 // 25MB memory usage
  };

  // Create test file with delta
  const baseFile = dataGenerator.generateLargeFileWithPatterns(20480); // 20KB
  const baseResult = store.storeObject(baseFile, 'blob');

  const modifiedFile = dataGenerator.generateFileWithChanges(baseFile, 'small');
  const deltaResult = store.storeBlobWithDelta(modifiedFile, baseResult.hash);

  if (deltaResult.usedDelta) {
    console.log('  Testing delta reconstruction performance...');

    // Measure reconstruction performance
    const performance = DeltaTestHelpers.measurePerformance(() => {
      return store.getObjectWithDelta(deltaResult.hash);
    });

    DeltaTestHelpers.logPerformanceMetrics(performance);
    DeltaTestHelpers.assertPerformanceBounds(performance, reconstructionBounds);

    // Verify reconstructed data is correct
    DeltaTestHelpers.assertDataIntegrity(modifiedFile, performance.result);
    console.log('    ✅ Delta reconstruction within performance bounds');
  } else {
    console.log('    ⚠️  Delta not used, skipping reconstruction test');
  }
}

function testMemoryUsage(store, dataGenerator) {
  const memoryBounds = {
    maxMemory: 100 * 1024 * 1024 // 100MB max memory usage
  };

  console.log('  Testing memory usage during large file compression...');

  // Create large file for memory testing
  const largeFile = dataGenerator.generateLargeFileWithPatterns(102400); // 100KB
  const baseResult = store.storeObject(largeFile, 'blob');

  // Create multiple versions to stress memory
  const versions = [];
  let currentFile = new Uint8Array(largeFile);

  for (let i = 0; i < 5; i++) {
    currentFile = dataGenerator.generateFileWithChanges(currentFile, 'small');

    const performance = DeltaTestHelpers.measurePerformance(() => {
      return store.storeBlobWithDelta(currentFile, baseResult.hash);
    });

    DeltaTestHelpers.assertPerformanceBounds(performance, memoryBounds);
    versions.push({ result: performance.result, data: new Uint8Array(currentFile) });

    console.log(`    Version ${i + 1}: Memory usage ${(performance.memoryDelta.heapUsed / 1024 / 1024).toFixed(2)}MB`);
  }

  // Verify all versions can be reconstructed
  for (let i = 0; i < versions.length; i++) {
    const version = versions[i];
    if (version.result.usedDelta) {
      const reconstructed = store.getObjectWithDelta(version.result.hash);
      DeltaTestHelpers.assertDataIntegrity(version.data, reconstructed);
    }
  }

  console.log('    ✅ Memory usage within acceptable bounds for all versions');
}

function testDeltaChainPerformance(store, dataGenerator) {
  console.log('  Testing performance with deep delta chains...');

  const chainBounds = {
    maxDuration: 1000, // 1 second per link in chain
    maxMemory: 50 * 1024 * 1024 // 50MB memory usage
  };

  // Create base file
  const baseFile = dataGenerator.generateSourceCode(300);
  let baseResult = store.storeObject(baseFile, 'blob');

  let currentFile = new Uint8Array(baseFile);
  const chainLength = 10;

  // Create delta chain
  for (let i = 0; i < chainLength; i++) {
    currentFile = dataGenerator.generateFileWithChanges(currentFile, 'small');

    const performance = DeltaTestHelpers.measurePerformance(() => {
      return store.storeBlobWithDelta(currentFile, baseResult.hash);
    });

    DeltaTestHelpers.assertPerformanceBounds(performance, chainBounds);

    if (performance.result.usedDelta) {
      // Update base for next iteration to create chain
      baseResult = { hash: performance.result.hash };
      console.log(`    Link ${i + 1}: ${(performance.result.compressionRatio * 100).toFixed(1)}% compression, ${performance.duration}ms`);
    } else {
      console.log(`    Link ${i + 1}: No delta used (${performance.result.reason})`);
      baseResult = { hash: performance.result.hash };
    }
  }

  // Test reconstruction performance for final file
  const finalReconstruction = DeltaTestHelpers.measurePerformance(() => {
    return store.getObjectWithDelta(baseResult.hash);
  });

  DeltaTestHelpers.assertPerformanceBounds(finalReconstruction, chainBounds);
  console.log(`    ✅ Delta chain of ${chainLength} links performs within bounds`);
}

module.exports = { runDeltaPerformanceTests };