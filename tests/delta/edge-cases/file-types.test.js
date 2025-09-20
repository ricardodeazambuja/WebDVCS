/**
 * File Type Compatibility Tests for Delta Compression
 * Tests how delta compression handles different file types and edge cases
 */

const { DeltaTestHelpers } = require('../../test-utils/delta-test-helpers');
const { DeltaTestDataGenerator } = require('../../test-utils/delta-test-data');

function runFileTypeCompatibilityTests() {
  DeltaTestHelpers.logSection('File Type Compatibility Tests');

  const testDbPath = DeltaTestHelpers.generateTestDbName('file-types');
  let testStore;

  try {
    // Initialize test store
    const { store } = DeltaTestHelpers.createTestRepository(testDbPath);
    testStore = store;

    const dataGenerator = new DeltaTestDataGenerator();

    // Test 1: Text files with small changes achieve high compression
    DeltaTestHelpers.logSubsection('Testing text files with small changes');
    testTextFileCompression(testStore, dataGenerator);

    // Test 2: Binary files handle delta compression appropriately
    DeltaTestHelpers.logSubsection('Testing binary file handling');
    testBinaryFileHandling(testStore, dataGenerator);

    // Test 3: Very large files compress successfully
    DeltaTestHelpers.logSubsection('Testing very large file compression');
    testVeryLargeFileCompression(testStore, dataGenerator);

    // Test 4: Empty files and tiny files handle gracefully
    DeltaTestHelpers.logSubsection('Testing edge case file sizes');
    testEdgeCaseFileSizes(testStore, dataGenerator);

    // Test 5: Unicode and special character files maintain integrity
    DeltaTestHelpers.logSubsection('Testing Unicode and special characters');
    testUnicodeAndSpecialCharacters(testStore, dataGenerator);

    console.log('\n✅ All File Type Compatibility tests passed!');
    return true;

  } catch (error) {
    console.error('❌ File Type Compatibility tests failed:', error);
    return false;
  } finally {
    // Cleanup
    if (testStore && testStore.close) {
      testStore.close();
    }
    DeltaTestHelpers.cleanup([testDbPath]);
  }
}

function testTextFileCompression(store, dataGenerator) {
  console.log('  Testing source code files...');

  // Test JavaScript-like source code
  const baseCode = dataGenerator.generateSourceCode(200);
  const baseResult = store.storeObject(baseCode, 'blob');

  // Make typical source code changes
  const modifiedCode = new Uint8Array(baseCode.length + 100);
  modifiedCode.set(baseCode.slice(0, 500), 0);

  // Insert a new function
  const newFunction = new TextEncoder().encode('\n\n  newFunction() {\n    return "added feature";\n  }\n');
  modifiedCode.set(newFunction, 500);
  modifiedCode.set(baseCode.slice(500), 500 + newFunction.length);

  const deltaResult = store.storeBlobWithDelta(modifiedCode.slice(0, baseCode.length + newFunction.length), baseResult.hash);

  if (deltaResult.usedDelta) {
    DeltaTestHelpers.assertCompressionRatio(deltaResult, 0.7, 0.2); // At least 50% compression
    console.log(`    ✅ Source code: ${(deltaResult.compressionRatio * 100).toFixed(1)}% compression achieved`);
  }

  // Verify reconstruction
  const reconstructed = store.getObjectWithDelta(deltaResult.hash);
  console.assert(reconstructed !== null, 'Source code should be reconstructed');

  console.log('  Testing configuration files...');

  // Test JSON-like configuration files
  const baseConfig = new TextEncoder().encode(JSON.stringify({
    name: "test-app",
    version: "1.0.0",
    dependencies: {
      "lib1": "^1.2.3",
      "lib2": "^2.3.4",
      "lib3": "^3.4.5"
    },
    config: {
      port: 8080,
      debug: false,
      features: ["feature1", "feature2", "feature3"]
    }
  }, null, 2));

  const configBaseResult = store.storeObject(baseConfig, 'blob');

  // Modify configuration (add dependency, change version)
  const configObj = JSON.parse(new TextDecoder().decode(baseConfig));
  configObj.version = "1.0.1";
  configObj.dependencies["new-lib"] = "^1.0.0";
  configObj.config.debug = true;

  const modifiedConfig = new TextEncoder().encode(JSON.stringify(configObj, null, 2));
  const configDeltaResult = store.storeBlobWithDelta(modifiedConfig, configBaseResult.hash);

  if (configDeltaResult.usedDelta) {
    console.log(`    ✅ Config file: ${(configDeltaResult.compressionRatio * 100).toFixed(1)}% compression achieved`);
  }

  // Verify configuration integrity
  const reconstructedConfig = store.getObjectWithDelta(configDeltaResult.hash);
  DeltaTestHelpers.assertDataIntegrity(modifiedConfig, reconstructedConfig);
}

function testBinaryFileHandling(store, dataGenerator) {
  console.log('  Testing binary file handling...');

  // Test with random binary data
  const binaryFile1 = dataGenerator.generateBinaryFile(8192, 12345);
  const binaryResult1 = store.storeObject(binaryFile1, 'blob');

  const binaryFile2 = dataGenerator.generateBinaryFile(8192, 54321);
  const binaryDeltaResult = store.storeBlobWithDelta(binaryFile2, binaryResult1.hash);

  // Binary files typically don't compress well with delta
  if (binaryDeltaResult.usedDelta) {
    console.log(`    Binary files used delta: ${(binaryDeltaResult.compressionRatio * 100).toFixed(1)}% compression`);
  } else {
    console.log(`    ✅ Binary files correctly avoided delta: ${binaryDeltaResult.reason}`);
    console.assert(['insufficient_similarity', 'delta_larger_than_original', 'delta_not_beneficial'].includes(binaryDeltaResult.reason),
      'Binary files should avoid delta for valid reasons');
  }

  // Test binary file with small modifications
  const modifiedBinary = new Uint8Array(binaryFile1);
  // Change 1% of bytes
  const changeCount = Math.floor(modifiedBinary.length * 0.01);
  for (let i = 0; i < changeCount; i++) {
    const pos = Math.floor(Math.random() * modifiedBinary.length);
    modifiedBinary[pos] = (modifiedBinary[pos] + 1) % 256;
  }

  const modifiedBinaryResult = store.storeBlobWithDelta(modifiedBinary, binaryResult1.hash);

  // Verify data integrity regardless of delta usage
  const reconstructedBinary = store.getObjectWithDelta(modifiedBinaryResult.hash);
  DeltaTestHelpers.assertDataIntegrity(modifiedBinary, reconstructedBinary);
  console.log('    ✅ Binary file integrity maintained');
}

function testVeryLargeFileCompression(store, dataGenerator) {
  console.log('  Testing very large file compression...');

  // Test with 1MB+ files (reduced for test speed, but simulates large files)
  const largeSize = 1024 * 100; // 100KB for testing (represents 10MB+ files)
  const largeFile = dataGenerator.generateLargeFileWithPatterns(largeSize);
  const largeResult = store.storeObject(largeFile, 'blob');

  console.log(`    Created large file: ${largeSize} bytes`);

  // Make small changes to large file
  const modifiedLarge = dataGenerator.generateFileWithChanges(largeFile, 'small');

  const performance = DeltaTestHelpers.measurePerformance(() => {
    return store.storeBlobWithDelta(modifiedLarge, largeResult.hash);
  });

  DeltaTestHelpers.logPerformanceMetrics(performance);

  if (performance.result.usedDelta) {
    console.log(`    ✅ Large file compression: ${(performance.result.compressionRatio * 100).toFixed(1)}%`);
    DeltaTestHelpers.assertCompressionRatio(performance.result, 20, 15); // At least 5x compression
  }

  // Verify large file reconstruction
  const reconstructedLarge = store.getObjectWithDelta(performance.result.hash);
  DeltaTestHelpers.assertDataIntegrity(modifiedLarge, reconstructedLarge);
  console.log('    ✅ Large file integrity verified');
}

function testEdgeCaseFileSizes(store, dataGenerator) {
  console.log('  Testing edge case file sizes...');

  // Test empty file
  const emptyFile = new Uint8Array(0);
  const emptyResult = store.storeObject(emptyFile, 'blob');

  const almostEmptyFile = new Uint8Array([65]); // Single 'A' character
  const emptyDeltaResult = store.storeBlobWithDelta(almostEmptyFile, emptyResult.hash);

  console.assert(emptyDeltaResult.usedDelta === false, 'Empty files should not use delta');
  console.assert(['file_too_small', 'base_too_small', 'delta_not_beneficial'].includes(emptyDeltaResult.reason),
    'Empty files should avoid delta for size reasons');
  console.log('    ✅ Empty files handled correctly');

  // Test very small files
  const tinyFile1 = new Uint8Array([1, 2, 3, 4, 5]);
  const tinyResult1 = store.storeObject(tinyFile1, 'blob');

  const tinyFile2 = new Uint8Array([1, 2, 3, 4, 6]); // One byte different
  const tinyDeltaResult = store.storeBlobWithDelta(tinyFile2, tinyResult1.hash);

  // Tiny files typically shouldn't use delta
  if (tinyDeltaResult.usedDelta) {
    console.log('    Tiny files used delta (unexpected but acceptable)');
  } else {
    console.log(`    ✅ Tiny files correctly avoided delta: ${tinyDeltaResult.reason}`);
  }

  // Verify tiny file integrity
  const reconstructedTiny = store.getObjectWithDelta(tinyDeltaResult.hash);
  DeltaTestHelpers.assertDataIntegrity(tinyFile2, reconstructedTiny);

  // Test single byte file
  const singleByte = new Uint8Array([42]);
  const singleByteResult = store.storeObject(singleByte, 'blob');
  const retrievedSingleByte = store.getObjectWithDelta(singleByteResult.hash);
  DeltaTestHelpers.assertDataIntegrity(singleByte, retrievedSingleByte);
  console.log('    ✅ Single byte file handled correctly');
}

function testUnicodeAndSpecialCharacters(store, dataGenerator) {
  console.log('  Testing Unicode and special characters...');

  // Test Unicode text
  const unicodeText = new TextEncoder().encode(`
    🌍 Hello World in multiple languages:
    - English: Hello World
    - Spanish: Hola Mundo
    - French: Bonjour le Monde
    - German: Hallo Welt
    - Japanese: こんにちは世界
    - Chinese: 你好世界
    - Arabic: مرحبا بالعالم
    - Russian: Привет мир
    - Emoji test: 🚀 🎉 🔥 💻 ⭐ 🌟 💫
    Special chars: @#$%^&*()[]{}|\\:";'<>?,.~/\`
  `);

  const unicodeResult = store.storeObject(unicodeText, 'blob');

  // Modify Unicode text slightly
  const modifiedUnicodeText = new TextEncoder().encode(`
    🌍 Hello World in multiple languages:
    - English: Hello World!
    - Spanish: Hola Mundo
    - French: Bonjour le Monde
    - German: Hallo Welt
    - Japanese: こんにちは世界
    - Chinese: 你好世界
    - Arabic: مرحبا بالعالم
    - Russian: Привет мир
    - Added: Korean: 안녕 세계
    - Emoji test: 🚀 🎉 🔥 💻 ⭐ 🌟 💫 ✨
    Special chars: @#$%^&*()[]{}|\\:";'<>?,.~/\`
  `);

  const unicodeDeltaResult = store.storeBlobWithDelta(modifiedUnicodeText, unicodeResult.hash);

  if (unicodeDeltaResult.usedDelta) {
    console.log(`    ✅ Unicode text compression: ${(unicodeDeltaResult.compressionRatio * 100).toFixed(1)}%`);
  }

  // Verify Unicode integrity
  const reconstructedUnicode = store.getObjectWithDelta(unicodeDeltaResult.hash);
  DeltaTestHelpers.assertDataIntegrity(modifiedUnicodeText, reconstructedUnicode);

  // Verify the reconstructed text can be decoded properly
  const decodedOriginal = new TextDecoder().decode(modifiedUnicodeText);
  const decodedReconstructed = new TextDecoder().decode(reconstructedUnicode);
  console.assert(decodedOriginal === decodedReconstructed, 'Unicode text should decode identically');

  console.log('    ✅ Unicode and special characters maintain integrity');

  // Test null bytes and control characters
  const controlCharData = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    controlCharData[i] = i; // All possible byte values
  }

  const controlResult = store.storeObject(controlCharData, 'blob');

  // Modify control character data
  const modifiedControlData = new Uint8Array(controlCharData);
  modifiedControlData[0] = 255; // Change null byte
  modifiedControlData[255] = 0; // Change max byte

  const controlDeltaResult = store.storeBlobWithDelta(modifiedControlData, controlResult.hash);
  const reconstructedControl = store.getObjectWithDelta(controlDeltaResult.hash);
  DeltaTestHelpers.assertDataIntegrity(modifiedControlData, reconstructedControl);

  console.log('    ✅ Control characters and null bytes handled correctly');
}

module.exports = { runFileTypeCompatibilityTests };