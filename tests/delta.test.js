/**
 * Content addressing and storage tests for v2 system
 * Note: v2 system uses pure content addressing without delta compression
 */

const { initStore } = require('../lib/core/storage');
const { storeBlob, getBlob } = require('../lib/core/objects');
const { hashData } = require('../lib/core/utils');

function runDeltaTests() {
  console.log('Running Storage Tests...\n');

  const testDB = process.env.TEST_DB || 'test-storage.sqlite';
  let store;

  try {
    // Clean up any existing test database
    const fs = require('fs');
    if (fs.existsSync(testDB)) {
      fs.unlinkSync(testDB);
    }

    store = initStore(testDB);

    // Test 1: Basic blob storage
    console.log('Testing basic blob storage...');
    testBasicBlobStorage(store);

    // Test 2: Small files storage
    console.log('Testing small files storage...');
    testSmallFileStorage(store);

    // Test 3: Large files storage
    console.log('Testing large files storage...');
    testLargeFileStorage(store);

    // Test 4: Storage deduplication
    console.log('Testing storage deduplication...');
    testStorageDeduplication(store);

    // Test 5: Content reconstruction
    console.log('Testing content reconstruction...');
    testContentReconstruction(store);

    // Test 6: Binary content handling
    console.log('Testing binary content handling...');
    testBinaryContent(store);

    console.log('\n✅ All storage tests passed!');
    return true;

  } catch (error) {
    console.error('❌ Storage tests failed:', error);
    return false;
  } finally {
    // Clean up in finally block to ensure it always runs
    try {
      if (store && store.close) {
        store.close();
      }
    } catch (err) {
      // Ignore cleanup errors
    }

    try {
      if (fs.existsSync(testDB)) {
        fs.unlinkSync(testDB);
      }
    } catch (err) {
      // Ignore cleanup errors
    }
  }
}

function testBasicBlobStorage(store) {
  const testData = new Uint8Array([1, 2, 3, 4, 5]);

  const result = storeBlob(testData, store);
  console.assert(typeof result.hash === 'string', 'Should return hash');
  console.assert(result.hash.length === 64, 'Hash should be SHA-256 (64 chars)');
  console.assert(typeof result.isNew === 'boolean', 'Should indicate if new');

  // Verify retrieval
  const retrieved = getBlob(result.hash, store);
  console.assert(retrieved !== null, 'Should retrieve stored blob');
  console.assert(retrieved.length === testData.length, 'Retrieved data should match length');
  console.assert(Array.from(retrieved).every((v, i) => v === testData[i]), 'Retrieved data should match content');

  console.log('✅ Basic blob storage tests passed');
}

function testSmallFileStorage(store) {
  const smallFile = new Uint8Array(1024); // 1KB file
  smallFile.fill(42);

  const result = storeBlob(smallFile, store);
  console.assert(typeof result.hash === 'string', 'Should return hash');
  console.assert(typeof result.isNew === 'boolean', 'Should indicate if new');

  // Verify retrieval works
  const retrieved = getBlob(result.hash, store);
  console.assert(retrieved !== null, 'Should be able to retrieve small file');
  console.assert(retrieved.length === smallFile.length, 'Retrieved file should have correct length');

  console.log('✅ Small files storage tests passed');
}

function testLargeFileStorage(store) {
  const largeFile = new Uint8Array(2048); // 2KB file for fast testing

  // Fill with pattern
  for (let i = 0; i < largeFile.length; i++) {
    largeFile[i] = (i % 256);
  }

  // Store file
  const result = storeBlob(largeFile, store);
  console.assert(typeof result.hash === 'string', 'Should return hash');

  // Verify retrieval works
  const retrieved = getBlob(result.hash, store);
  console.assert(retrieved !== null, 'Should retrieve large file');
  console.assert(retrieved.length === largeFile.length, 'Retrieved file should have correct length');
  console.assert(retrieved[100] === largeFile[100], 'Retrieved file should have correct content');
  console.assert(retrieved[1000] === largeFile[1000], 'Retrieved file should have correct content');

  console.log('✅ Large files storage tests passed');
}

function testStorageDeduplication(store) {
  const data = new Uint8Array(1024);
  data.fill(123);

  // Store first instance
  const result1 = storeBlob(data, store);
  console.assert(result1.isNew === true, 'First instance should be new');

  // Store identical data again - should deduplicate
  const result2 = storeBlob(data, store);
  console.assert(result2.hash === result1.hash, 'Identical content should have same hash');
  console.assert(result2.isNew === false, 'Duplicate should not be new');

  // Verify both can be retrieved
  const retrieved1 = getBlob(result1.hash, store);
  const retrieved2 = getBlob(result2.hash, store);
  console.assert(retrieved1 !== null, 'Should retrieve first instance');
  console.assert(retrieved2 !== null, 'Should retrieve second instance');
  console.assert(retrieved1.length === retrieved2.length, 'Both should have same length');

  console.log('✅ Storage deduplication tests passed');
}

function testContentReconstruction(store) {
  const baseData = new Uint8Array(1024);
  for (let i = 0; i < baseData.length; i++) {
    baseData[i] = i % 256;
  }

  // Store base
  const baseResult = storeBlob(baseData, store);

  // Create modified version
  const modifiedData = new Uint8Array(baseData);
  modifiedData[100] = 199;
  modifiedData[500] = 200;

  // Store modified version
  const modifiedResult = storeBlob(modifiedData, store);
  console.assert(modifiedResult.hash !== baseResult.hash, 'Modified data should have different hash');

  // Test retrieval
  const retrieved = getBlob(modifiedResult.hash, store);
  console.assert(retrieved !== null, 'Should retrieve stored data');
  console.assert(retrieved.length === modifiedData.length, 'Retrieved length should match');
  console.assert(retrieved[100] === 199, 'Specific changes should be preserved');
  console.assert(retrieved[500] === 200, 'Specific changes should be preserved');

  // Verify hash matches
  const reconstructedHash = hashData(retrieved);
  console.assert(reconstructedHash === modifiedResult.hash, 'Reconstructed hash should match');

  console.log('✅ Content reconstruction tests passed');
}

function testBinaryContent(store) {
  // Create binary-like data
  const binaryData = new Uint8Array(512);
  for (let i = 0; i < binaryData.length; i++) {
    binaryData[i] = Math.floor(Math.random() * 256);
  }

  // Store binary data
  const result = storeBlob(binaryData, store);
  console.assert(typeof result.hash === 'string', 'Should return hash for binary data');

  // Retrieve and verify
  const retrieved = getBlob(result.hash, store);
  console.assert(retrieved !== null, 'Should retrieve binary data');
  console.assert(retrieved.length === binaryData.length, 'Binary data length should match');

  // Verify content byte by byte
  for (let i = 0; i < binaryData.length; i++) {
    console.assert(retrieved[i] === binaryData[i], `Binary data should match at byte ${i}`);
  }

  console.log('✅ Binary content tests passed');
}

module.exports = { runDeltaTests };