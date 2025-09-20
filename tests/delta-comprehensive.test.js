/**
 * Comprehensive Delta Integration Tests
 * This replaces the basic delta.test.js with comprehensive delta functionality testing
 */

const { runE2ERepositoryTests } = require('./delta/integration/e2e-repository.test');
const { runDeltaPerformanceTests } = require('./delta/performance/compression-ratios.test');
const { runFileTypeCompatibilityTests } = require('./delta/edge-cases/file-types.test');
const { runErrorHandlingTests } = require('./delta/edge-cases/error-handling.test');
const { DeltaTestHelpers } = require('./test-utils/delta-test-helpers');

function runComprehensiveDeltaTests() {
  console.log('🧪 Comprehensive Delta Integration Test Suite');
  console.log('===============================================\n');

  const startTime = Date.now();
  let totalPassed = 0;
  let totalFailed = 0;
  const results = [];

  // Test suite modules in order of importance
  const testSuites = [
    {
      name: 'E2E Repository Integration',
      runner: runE2ERepositoryTests,
      description: 'Tests delta compression within complete repository workflows'
    },
    {
      name: 'Performance Validation',
      runner: runDeltaPerformanceTests,
      description: 'Tests compression ratios, speed, and memory usage'
    },
    {
      name: 'File Type Compatibility',
      runner: runFileTypeCompatibilityTests,
      description: 'Tests different file types and edge case sizes'
    },
    {
      name: 'Error Handling & Recovery',
      runner: runErrorHandlingTests,
      description: 'Tests error conditions and corruption scenarios'
    }
  ];

  console.log('📋 Test Suite Overview:');
  testSuites.forEach((suite, index) => {
    console.log(`  ${index + 1}. ${suite.name}: ${suite.description}`);
  });
  console.log('');

  // Run each test suite
  for (const suite of testSuites) {
    console.log(`🔧 Running ${suite.name} tests...`);
    const suiteStartTime = Date.now();

    try {
      const success = suite.runner();
      const suiteEndTime = Date.now();
      const duration = suiteEndTime - suiteStartTime;

      if (success) {
        totalPassed++;
        results.push({ suite: suite.name, status: 'PASS', duration });
        console.log(`✅ ${suite.name} tests PASSED (${duration}ms)\n`);
      } else {
        totalFailed++;
        results.push({ suite: suite.name, status: 'FAIL', duration });
        console.log(`❌ ${suite.name} tests FAILED (${duration}ms)\n`);
      }
    } catch (error) {
      totalFailed++;
      const suiteEndTime = Date.now();
      const duration = suiteEndTime - suiteStartTime;
      results.push({ suite: suite.name, status: 'ERROR', duration, error: error.message });
      console.error(`💥 ${suite.name} tests ERROR: ${error.message} (${duration}ms)\n`);
    }
  }

  // Generate comprehensive summary
  const endTime = Date.now();
  const totalDuration = endTime - startTime;

  console.log('📊 Comprehensive Delta Test Summary');
  console.log('=====================================');
  console.log(`Total test suites: ${testSuites.length}`);
  console.log(`Passed: ${totalPassed}`);
  console.log(`Failed: ${totalFailed}`);
  console.log(`Duration: ${totalDuration}ms\n`);

  // Detailed results
  console.log('📋 Detailed Results:');
  results.forEach(result => {
    const statusIcon = result.status === 'PASS' ? '✅' : result.status === 'FAIL' ? '❌' : '💥';
    const statusText = result.status.padEnd(5);
    const duration = `${result.duration}ms`.padEnd(8);
    console.log(`  ${statusIcon} ${result.suite.padEnd(25)} ${statusText} ${duration}`);

    if (result.error) {
      console.log(`      Error: ${result.error}`);
    }
  });

  console.log();

  // Final assessment
  if (totalFailed === 0) {
    console.log('🎉 All comprehensive delta tests passed!');
    console.log('✅ Delta compression system is fully functional and ready for production.');
    console.log('✅ Performance metrics are within acceptable bounds.');
    console.log('✅ Error handling is robust and reliable.');
    console.log('✅ File type compatibility is comprehensive.');
    return true;
  } else {
    console.log('⚠️  Some comprehensive delta tests failed.');
    console.log('❌ Delta compression system requires attention before production use.');

    // Provide guidance based on which tests failed
    const failedSuites = results.filter(r => r.status !== 'PASS').map(r => r.suite);
    console.log('\n🔧 Recommendations:');

    if (failedSuites.includes('E2E Repository Integration')) {
      console.log('  • Fix repository integration issues - delta system not properly integrated');
    }
    if (failedSuites.includes('Performance Validation')) {
      console.log('  • Optimize delta algorithms for better performance');
    }
    if (failedSuites.includes('File Type Compatibility')) {
      console.log('  • Improve handling of different file types and edge cases');
    }
    if (failedSuites.includes('Error Handling & Recovery')) {
      console.log('  • Strengthen error handling and recovery mechanisms');
    }

    return false;
  }
}

// Additional utility tests specific to delta functionality
function runBasicDeltaAlgorithmTests() {
  DeltaTestHelpers.logSection('Basic Delta Algorithm Verification');

  try {
    // Test delta algorithm directly
    const { createDelta, applyDelta, isDeltaWorthwhile } = require('../lib/core/delta');

    const baseData = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const newData = new Uint8Array([1, 2, 3, 99, 5, 6, 7, 8, 9, 10]); // Changed byte 4

    console.log('  Testing basic delta creation...');
    const delta = createDelta(baseData, newData);
    console.assert(delta !== null, 'Delta creation should succeed');
    console.log('  ✅ Delta creation successful');

    console.log('  Testing delta application...');
    const reconstructed = applyDelta(baseData, delta);
    DeltaTestHelpers.assertDataIntegrity(newData, reconstructed);
    console.log('  ✅ Delta application successful');

    console.log('  Testing delta worthwhile check...');
    const isWorthwhile = isDeltaWorthwhile(baseData, newData, delta);
    console.log(`  Delta worthwhile: ${isWorthwhile}`);
    console.log('  ✅ Delta worthwhile check successful');

    return true;
  } catch (error) {
    console.error('  ❌ Basic delta algorithm test failed:', error);
    return false;
  }
}

// Quick verification that storage integration works
function runQuickStorageIntegrationTest() {
  DeltaTestHelpers.logSection('Quick Storage Integration Verification');

  const testDbPath = DeltaTestHelpers.generateTestDbName('quick-integration');
  let testStore;

  try {
    const { store } = DeltaTestHelpers.createTestRepository(testDbPath);
    testStore = store;

    // Quick test of storeBlobWithDelta method
    const testData1 = new Uint8Array([1, 2, 3, 4, 5]);
    const result1 = testStore.storeObject(testData1, 'blob');

    const testData2 = new Uint8Array([1, 2, 3, 99, 5]);
    const result2 = testStore.storeBlobWithDelta(testData2, result1.hash);

    console.log('  ✅ storeBlobWithDelta method exists and callable');
    console.log(`  Delta used: ${result2.usedDelta}, Reason: ${result2.reason || 'N/A'}`);

    // Verify retrieval works
    const retrieved = testStore.getObjectWithDelta(result2.hash);
    DeltaTestHelpers.assertDataIntegrity(testData2, retrieved);
    console.log('  ✅ getObjectWithDelta method works correctly');

    return true;
  } catch (error) {
    console.error('  ❌ Quick storage integration test failed:', error);
    return false;
  } finally {
    if (testStore && testStore.close) {
      testStore.close();
    }
    DeltaTestHelpers.cleanup([testDbPath]);
  }
}

// Main test function that runs all comprehensive tests
function runDeltaTests() {
  console.log('🚀 Starting Comprehensive Delta Test Suite\n');

  // First run quick verification tests
  console.log('⚡ Running Quick Verification Tests...\n');

  const basicAlgorithmSuccess = runBasicDeltaAlgorithmTests();
  const quickIntegrationSuccess = runQuickStorageIntegrationTest();

  if (!basicAlgorithmSuccess || !quickIntegrationSuccess) {
    console.log('\n❌ Basic verification tests failed - aborting comprehensive tests');
    console.log('💡 Fix basic delta algorithm or storage integration issues first');
    return false;
  }

  console.log('\n✅ Quick verification tests passed - proceeding with comprehensive tests\n');

  // Run comprehensive test suite
  const comprehensiveSuccess = runComprehensiveDeltaTests();

  return comprehensiveSuccess;
}

module.exports = {
  runDeltaTests,
  runComprehensiveDeltaTests,
  runBasicDeltaAlgorithmTests,
  runQuickStorageIntegrationTest
};