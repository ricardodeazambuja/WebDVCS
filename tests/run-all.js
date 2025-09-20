#!/usr/bin/env node

/**
 * Test Runner - Run all WebDVCS library tests
 * 
 * Runs all test modules in order and reports results.
 * No test framework bloat - just simple, real tests.
 */

const { runUtilsTests } = require('./utils.test');
const { runStorageTests } = require('./storage.test');
const { runObjectsTests } = require('./objects.test');
const { runDiffTests } = require('./diff.test');
const { runRepoTests } = require('./repo.test');
const { runIntegrationTests } = require('./integration.test');
const { runRmTests } = require('./rm.test');
const { runResetTests } = require('./reset.test');
const { runMergeTests } = require('./merge.test');
const { runDeltaTests } = require('./delta-comprehensive.test');

// Test modules in dependency order
const testModules = [
  { name: 'Utils', runner: runUtilsTests },
  { name: 'Storage', runner: runStorageTests },
  { name: 'Delta', runner: runDeltaTests },
  { name: 'Objects', runner: runObjectsTests },
  { name: 'Diff', runner: runDiffTests },
  { name: 'Repository', runner: runRepoTests },
  { name: 'CLI', runner: require('./cli.test').runCLITests },
  { name: 'Rm', runner: runRmTests },
  { name: 'Reset', runner: runResetTests },
  { name: 'Merge', runner: runMergeTests },
  { name: 'Integration', runner: runIntegrationTests }
];

function runAllTests() {
  console.log('🧪 WebDVCS Library Test Suite');
  console.log('============================\n');
  
  let totalPassed = 0;
  let totalFailed = 0;
  const results = [];
  const startTime = Date.now();
  
  for (const module of testModules) {
    console.log(`📋 Running ${module.name} tests...`);
    const moduleStartTime = Date.now();
    
    try {
      const success = module.runner();
      const moduleEndTime = Date.now();
      const duration = moduleEndTime - moduleStartTime;
      
      if (success) {
        totalPassed++;
        results.push({ module: module.name, status: 'PASS', duration });
        console.log(`✅ ${module.name} tests PASSED (${duration}ms)\n`);
      } else {
        totalFailed++;
        results.push({ module: module.name, status: 'FAIL', duration });
        console.log(`❌ ${module.name} tests FAILED (${duration}ms)\n`);
      }
    } catch (error) {
      totalFailed++;
      const moduleEndTime = Date.now();
      const duration = moduleEndTime - moduleStartTime;
      results.push({ module: module.name, status: 'ERROR', duration, error: error.message });
      console.error(`💥 ${module.name} tests ERROR: ${error.message} (${duration}ms)\n`);
    }
  }
  
  // Summary
  const endTime = Date.now();
  const totalDuration = endTime - startTime;
  
  console.log('📊 Test Summary');
  console.log('================');
  console.log(`Total modules: ${testModules.length}`);
  console.log(`Passed: ${totalPassed}`);
  console.log(`Failed: ${totalFailed}`);
  console.log(`Duration: ${totalDuration}ms\n`);
  
  // Detailed results
  console.log('📋 Detailed Results:');
  results.forEach(result => {
    const statusIcon = result.status === 'PASS' ? '✅' : result.status === 'FAIL' ? '❌' : '💥';
    const statusText = result.status.padEnd(5);
    const duration = `${result.duration}ms`.padEnd(8);
    console.log(`  ${statusIcon} ${result.module.padEnd(12)} ${statusText} ${duration}`);
    
    if (result.error) {
      console.log(`      Error: ${result.error}`);
    }
  });
  
  console.log();
  
  if (totalFailed === 0) {
    console.log('🎉 All tests passed! The WebDVCS library is working correctly.');
    return true;
  } else {
    console.log('⚠️  Some tests failed. Please fix the issues before proceeding.');
    return false;
  }
}

// Additional command-line options
function printUsage() {
  console.log('WebDVCS Test Runner');
  console.log('Usage: node tests/run-all.js [options]');
  console.log('');
  console.log('Options:');
  console.log('  --help, -h    Show this help message');
  console.log('  --quiet, -q   Run tests quietly (less output)');
  console.log('  --module, -m  Run specific module only');
  console.log('');
  console.log('Available modules:');
  testModules.forEach(module => {
    console.log(`  - ${module.name.toLowerCase()}`);
  });
}

function runSpecificModule(moduleName) {
  const module = testModules.find(m => m.name.toLowerCase() === moduleName.toLowerCase());
  
  if (!module) {
    console.error(`❌ Unknown module: ${moduleName}`);
    console.log('Available modules:', testModules.map(m => m.name.toLowerCase()).join(', '));
    return false;
  }
  
  console.log(`🧪 Running ${module.name} tests only...\n`);
  const success = module.runner();
  
  if (success) {
    console.log(`\n✅ ${module.name} tests completed successfully!`);
  } else {
    console.log(`\n❌ ${module.name} tests failed!`);
  }
  
  return success;
}

// Parse command line arguments
function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    return true;
  }
  
  const moduleIndex = args.findIndex(arg => arg === '--module' || arg === '-m');
  if (moduleIndex !== -1 && moduleIndex + 1 < args.length) {
    const moduleName = args[moduleIndex + 1];
    const success = runSpecificModule(moduleName);
    process.exit(success ? 0 : 1);
  }
  
  if (args.includes('--quiet') || args.includes('-q')) {
    // Suppress console.log for quiet mode
    const originalLog = console.log;
    console.log = () => {};
    
    const success = runAllTests();
    
    // Restore console.log
    console.log = originalLog;
    console.log(success ? '✅ All tests passed' : '❌ Some tests failed');
    
    process.exit(success ? 0 : 1);
  }
  
  // Run all tests normally
  const success = runAllTests();
  process.exit(success ? 0 : 1);
}

// Run if called directly
if (require.main === module) {
  main();
} else {
  // Export for programmatic use
  module.exports = {
    runAllTests,
    runSpecificModule,
    testModules
  };
}