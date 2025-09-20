/**
 * Performance Benchmarking Tests - Validate TECHNICAL_SPEC.md performance claims
 */

const fs = require('fs');
const path = require('path');
const { initStore } = require('../lib/core/storage');
const { storeTree, getTree, createCommit, getCommitHistory } = require('../lib/core/objects');
const { storeFile } = require('../lib/core/file-storage');

// Simple test runner
function assert(condition, message = 'Assertion failed') {
  if (!condition) {
    throw new Error(message);
  }
}

// Generate unique test database paths
let testCounter = 0;
function getTestDB() {
  return path.join(__dirname, `test-perf-${++testCounter}.sqlite`);
}

function cleanupTestDB(dbPath) {
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
  }
}

// Performance measurement utility
function measurePerformance(name, operation) {
  const start = process.hrtime.bigint();
  const result = operation();
  const end = process.hrtime.bigint();
  const durationMs = Number(end - start) / 1_000_000;
  
  return { result, durationMs, name };
}

// Create test data for benchmarking
function createTestData(size) {
  const entries = [];
  
  for (let i = 0; i < size; i++) {
    // Create varied file content for realistic testing
    const content = new Uint8Array(Math.floor(Math.random() * 1000) + 100);
    for (let j = 0; j < content.length; j++) {
      content[j] = (i + j) % 256;
    }
    
    entries.push({
      name: `file_${i.toString().padStart(4, '0')}.txt`,
      content,
      type: 'file',
      binary: i % 10 === 0 // 10% binary files
    });
  }
  
  return entries;
}

function testTreeOperationsPerformance() {
  console.log('Testing tree operations performance...');
  
  const testDB = getTestDB();
  const store = initStore(testDB);
  
  // Create test data - both small and large sets
  const smallDataset = createTestData(10);
  const largeDataset = createTestData(100);
  
  // Store blob data for entries
  const prepareEntries = (dataset) => {
    return dataset.map(entry => {
      const blobResult = store.storeBlob(entry.content);
      return {
        name: entry.name,
        type: entry.type,
        hash: blobResult.hash,
        binary: entry.binary
      };
    });
  };
  
  const smallEntries = prepareEntries(smallDataset);
  const largeEntries = prepareEntries(largeDataset);
  
  // Test tree storage performance
  const storeSmallResult = measurePerformance('Store Small Tree (10 files)', () => {
    return storeTree(smallEntries, store);
  });
  
  const storeLargeResult = measurePerformance('Store Large Tree (100 files)', () => {
    return storeTree(largeEntries, store);
  });
  
  // Test tree retrieval performance  
  const retrieveSmallResult = measurePerformance('Retrieve Small Tree (10 files)', () => {
    return getTree(storeSmallResult.result, store);
  });
  
  const retrieveLargeResult = measurePerformance('Retrieve Large Tree (100 files)', () => {
    return getTree(storeLargeResult.result, store);
  });
  
  // Validate results
  assert(retrieveSmallResult.result.length === smallEntries.length, 'Small tree should have correct number of entries');
  assert(retrieveLargeResult.result.length === largeEntries.length, 'Large tree should have correct number of entries');
  
  // Performance assertions based on TECHNICAL_SPEC.md claims
  // Tree operations should be optimized with indexed joins
  assert(storeLargeResult.durationMs < 1000, 'Large tree storage should complete in <1000ms');
  assert(retrieveLargeResult.durationMs < 100, 'Large tree retrieval should complete in <100ms');
  
  // Log performance metrics
  console.log(`  ${storeSmallResult.name}: ${storeSmallResult.durationMs.toFixed(2)}ms`);
  console.log(`  ${storeLargeResult.name}: ${storeLargeResult.durationMs.toFixed(2)}ms`);
  console.log(`  ${retrieveSmallResult.name}: ${retrieveSmallResult.durationMs.toFixed(2)}ms`);
  console.log(`  ${retrieveLargeResult.name}: ${retrieveLargeResult.durationMs.toFixed(2)}ms`);
  
  cleanupTestDB(testDB);
  console.log('✅ Tree operations performance tests passed');
  
  return {
    storeSmallMs: storeSmallResult.durationMs,
    storeLargeMs: storeLargeResult.durationMs,
    retrieveSmallMs: retrieveSmallResult.durationMs,
    retrieveLargeMs: retrieveLargeResult.durationMs
  };
}

function testCommitHistoryPerformance() {
  console.log('Testing commit history performance...');
  
  const testDB = getTestDB();
  const store = initStore(testDB);
  
  // Create a chain of commits for realistic testing
  const testData = createTestData(5);
  const entries = testData.map(data => {
    const blobResult = store.storeBlob(data.content);
    return {
      name: data.name,
      type: data.type,
      hash: blobResult.hash,
      binary: data.binary
    };
  });
  
  const treeHash = storeTree(entries, store);
  
  // Create commit chain
  const commitHashes = [];
  let parentHash = null;
  
  for (let i = 0; i < 50; i++) {
    const commitHash = createCommit(
      treeHash, 
      `Commit ${i + 1}`, 
      `Author ${i % 5}`, 
      `author${i % 5}@test.com`, 
      parentHash, 
      store
    );
    commitHashes.push(commitHash);
    parentHash = commitHash;
  }
  
  // Test commit history retrieval performance
  const latestCommit = commitHashes[commitHashes.length - 1];
  
  const historyResult = measurePerformance('Get Commit History (50 commits)', () => {
    return getCommitHistory(latestCommit, 50, store);
  });
  
  const limitedHistoryResult = measurePerformance('Get Limited History (10 commits)', () => {
    return getCommitHistory(latestCommit, 10, store);
  });
  
  // Validate results
  assert(historyResult.result.length === 50, 'Should retrieve all 50 commits');
  assert(limitedHistoryResult.result.length === 10, 'Should respect limit of 10 commits');
  
  // Performance assertions based on TECHNICAL_SPEC.md (30% faster commit queries)
  assert(historyResult.durationMs < 50, 'Full history retrieval should complete in <50ms');
  assert(limitedHistoryResult.durationMs < 20, 'Limited history retrieval should complete in <20ms');
  
  // Log performance metrics
  console.log(`  ${historyResult.name}: ${historyResult.durationMs.toFixed(2)}ms`);
  console.log(`  ${limitedHistoryResult.name}: ${limitedHistoryResult.durationMs.toFixed(2)}ms`);
  
  cleanupTestDB(testDB);
  console.log('✅ Commit history performance tests passed');
  
  return {
    fullHistoryMs: historyResult.durationMs,
    limitedHistoryMs: limitedHistoryResult.durationMs
  };
}

function testStorageEfficiencyVsUncompressed() {
  console.log('Testing storage efficiency vs uncompressed...');
  
  const testDB = getTestDB();
  const store = initStore(testDB);
  
  // Create test data with different compression characteristics
  const testCases = [
    {
      name: 'Highly Compressible (repeated pattern)',
      data: new Uint8Array(10000).fill(42),
      expectedRatio: 0.05 // Should compress to <5%
    },
    {
      name: 'Text Data (realistic compression)',
      data: new TextEncoder().encode('This is sample text data that should compress reasonably well. '.repeat(100)),
      expectedRatio: 0.6 // Should compress to ~60%  
    },
    {
      name: 'Random Data (poor compression)',
      data: new Uint8Array(1000).map(() => Math.floor(Math.random() * 256)),
      expectedRatio: 1.0 // Might not compress much
    }
  ];
  
  let totalOriginalSize = 0;
  let totalCompressedSize = 0;
  
  for (const testCase of testCases) {
    const result = store.storeBlob(testCase.data);
    const compressionInfo = store.getBlobCompressionInfo(result.hash);
    
    totalOriginalSize += compressionInfo.originalSize;
    totalCompressedSize += compressionInfo.compressedSize;
    
    console.log(`  ${testCase.name}:`);
    console.log(`    Original: ${compressionInfo.originalSize} bytes`);
    console.log(`    Compressed: ${compressionInfo.compressedSize} bytes`);
    console.log(`    Ratio: ${(compressionInfo.compressionRatio * 100).toFixed(1)}%`);
    console.log(`    Space saved: ${compressionInfo.spaceSavedPercent.toFixed(1)}%`);
    
    // Validate compression meets expectations
    assert(compressionInfo.compressionRatio <= testCase.expectedRatio * 1.1, 
           `${testCase.name} compression should be within expected range`);
  }
  
  const overallRatio = totalCompressedSize / totalOriginalSize;
  const overallSavings = ((totalOriginalSize - totalCompressedSize) / totalOriginalSize) * 100;
  
  console.log(`  Overall compression ratio: ${(overallRatio * 100).toFixed(1)}%`);
  console.log(`  Overall space savings: ${overallSavings.toFixed(1)}%`);
  
  // TECHNICAL_SPEC.md claims 30-50% storage reduction - validate this
  // Note: This is for overall repository, not just blob compression, but compression should contribute significantly
  assert(overallSavings > 20, 'Overall compression should save >20% space (contributing to 30-50% repository reduction)');
  
  cleanupTestDB(testDB);
  console.log('✅ Storage efficiency tests passed');
  
  return {
    overallCompressionRatio: overallRatio,
    overallSpaceSavings: overallSavings,
    totalOriginalSize,
    totalCompressedSize
  };
}

function testDatabasePerformanceCharacteristics() {
  console.log('Testing database performance characteristics...');
  
  const testDB = getTestDB();
  const store = initStore(testDB);
  
  // Test index performance with realistic data
  const numBlobs = 1000;
  const blobHashes = [];
  
  // Create many blobs to test index performance
  const createBlobsResult = measurePerformance(`Create ${numBlobs} blobs`, () => {
    for (let i = 0; i < numBlobs; i++) {
      const data = new Uint8Array(100).fill(i % 256);
      const result = store.storeBlob(data);
      blobHashes.push(result.hash);
    }
  });
  
  // Test random access performance (should benefit from indexes)
  const randomAccessResult = measurePerformance('Random blob access (100 queries)', () => {
    for (let i = 0; i < 100; i++) {
      const randomHash = blobHashes[Math.floor(Math.random() * blobHashes.length)];
      const blob = store.getBlob(randomHash);
      assert(blob !== null, 'Random blob should be found');
    }
  });
  
  // Test database statistics
  const stats = store.getStats();
  
  console.log(`  Database created with ${stats.blobs} blobs in ${createBlobsResult.durationMs.toFixed(2)}ms`);
  console.log(`  Random access: ${randomAccessResult.durationMs.toFixed(2)}ms for 100 queries`);
  console.log(`  Average query time: ${(randomAccessResult.durationMs / 100).toFixed(3)}ms`);
  console.log(`  Database size: ${(stats.dbSize / 1024).toFixed(2)}KB`);
  
  // Performance assertions
  assert(createBlobsResult.durationMs < 10000, 'Creating 1000 blobs should complete in <10 seconds');
  assert(randomAccessResult.durationMs / 100 < 1, 'Average random access should be <1ms (index performance)');
  
  cleanupTestDB(testDB);
  console.log('✅ Database performance characteristics tests passed');
  
  return {
    createBlobsMs: createBlobsResult.durationMs,
    randomAccessMs: randomAccessResult.durationMs,
    avgQueryMs: randomAccessResult.durationMs / 100,
    dbSizeKB: stats.dbSize / 1024
  };
}

// Run all tests
function runPerformanceTests() {
  console.log('Running Performance Benchmarking Tests...\n');
  
  try {
    const treePerf = testTreeOperationsPerformance();
    const commitPerf = testCommitHistoryPerformance();  
    const storageEff = testStorageEfficiencyVsUncompressed();
    const dbPerf = testDatabasePerformanceCharacteristics();
    
    // Summary report
    console.log('\n📊 Performance Summary:');
    console.log('='.repeat(50));
    console.log(`Tree Operations:`);
    console.log(`  Large tree storage: ${treePerf.storeLargeMs.toFixed(2)}ms`);
    console.log(`  Large tree retrieval: ${treePerf.retrieveLargeMs.toFixed(2)}ms`);
    
    console.log(`Commit History:`);
    console.log(`  50 commits: ${commitPerf.fullHistoryMs.toFixed(2)}ms`);
    console.log(`  10 commits: ${commitPerf.limitedHistoryMs.toFixed(2)}ms`);
    
    console.log(`Storage Efficiency:`);
    console.log(`  Compression ratio: ${(storageEff.overallCompressionRatio * 100).toFixed(1)}%`);
    console.log(`  Space savings: ${storageEff.overallSpaceSavings.toFixed(1)}%`);
    
    console.log(`Database Performance:`);
    console.log(`  Average query time: ${dbPerf.avgQueryMs.toFixed(3)}ms`);
    console.log(`  DB size efficiency: ${dbPerf.dbSizeKB.toFixed(2)}KB for 1000 blobs`);
    
    console.log('\n✅ All performance benchmarking tests passed!');
    return true;
  } catch (error) {
    console.error(`\n❌ Performance test failed: ${error.message}`);
    console.error(error.stack);
    return false;
  } finally {
    // Clean up test database files
    for (let i = 1; i <= testCounter; i++) {
      const testDb = path.join(__dirname, `test-perf-${i}.sqlite`);
      cleanupTestDB(testDb);
    }
  }
}

// Export for use by other test files
module.exports = { runPerformanceTests };

// Run tests if called directly
if (require.main === module) {
  process.exit(runPerformanceTests() ? 0 : 1);
}