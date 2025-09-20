/**
 * Utils Tests - Real tests for utility functions
 */

const { hashData, isBinary, arraysEqual, stringToUint8Array, uint8ArrayToString } = require('../lib/core/utils');

// Simple test runner
function assert(condition, message = 'Assertion failed') {
  if (!condition) {
    throw new Error(message);
  }
}

function testHashData() {
  console.log('Testing hashData...');
  
  const data1 = new Uint8Array([1, 2, 3]);
  const data2 = new Uint8Array([1, 2, 3]);
  const data3 = new Uint8Array([1, 2, 4]);
  
  const hash1 = hashData(data1);
  const hash2 = hashData(data2);
  const hash3 = hashData(data3);
  
  assert(hash1 === hash2, 'Same data should have same hash');
  assert(hash1 !== hash3, 'Different data should have different hash');
  assert(typeof hash1 === 'string', 'Hash should be string');
  assert(hash1.length === 64, 'Hash should be 64 characters (SHA-256)');
  
  console.log('✅ hashData tests passed');
}

function testIsBinary() {
  console.log('Testing isBinary...');
  
  // Text data
  const textData = stringToUint8Array('Hello world\nThis is text');
  assert(!isBinary(textData), 'Text should not be detected as binary');
  
  // Binary data with null bytes
  const binaryData = new Uint8Array([0x00, 0x01, 0xFF, 0x00]);
  assert(isBinary(binaryData), 'Data with null bytes should be binary');
  
  // Empty data
  const emptyData = new Uint8Array([]);
  assert(!isBinary(emptyData), 'Empty data should not be binary');
  
  // Mixed data with low printable ratio
  const mixedData = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05]);
  assert(isBinary(mixedData), 'Data with low printable ratio should be binary');
  
  // Test 8192-byte threshold as specified in TECHNICAL_SPEC.md
  // File with text in first 8192 bytes, null byte after - should be detected as text
  const largeText = new Uint8Array(9000);
  for (let i = 0; i < 8192; i++) {
    largeText[i] = 0x41; // 'A'
  }
  largeText[8500] = 0x00; // null byte after 8192 threshold
  assert(!isBinary(largeText), 'Text with null byte after 8192 boundary should be detected as text');
  
  // File with null byte within first 8192 bytes - should be detected as binary
  const largeTextWithEarlyNull = new Uint8Array(9000);
  for (let i = 0; i < 9000; i++) {
    largeTextWithEarlyNull[i] = 0x41; // 'A'
  }
  largeTextWithEarlyNull[4000] = 0x00; // null byte within 8192 boundary
  assert(isBinary(largeTextWithEarlyNull), 'Text with null byte within 8192 boundary should be detected as binary');
  
  console.log('✅ isBinary tests passed');
}

function testArraysEqual() {
  console.log('Testing arraysEqual...');
  
  const arr1 = new Uint8Array([1, 2, 3]);
  const arr2 = new Uint8Array([1, 2, 3]);
  const arr3 = new Uint8Array([1, 2, 4]);
  const arr4 = new Uint8Array([1, 2]);
  
  assert(arraysEqual(arr1, arr2), 'Same arrays should be equal');
  assert(!arraysEqual(arr1, arr3), 'Different arrays should not be equal');
  assert(!arraysEqual(arr1, arr4), 'Arrays of different length should not be equal');
  
  console.log('✅ arraysEqual tests passed');
}

function testStringConversion() {
  console.log('Testing string conversion...');
  
  const text = 'Hello, 世界! 🌍';
  const data = stringToUint8Array(text);
  const recovered = uint8ArrayToString(data);
  
  assert(recovered === text, 'String should round-trip correctly');
  assert(data instanceof Uint8Array, 'Should return Uint8Array');
  assert(data.length > text.length, 'UTF-8 encoding should be longer than string');
  
  console.log('✅ String conversion tests passed');
}

// Run all tests
function runUtilsTests() {
  console.log('Running Utils Tests...\n');
  
  try {
    testHashData();
    testIsBinary();
    testArraysEqual();
    testStringConversion();
    
    console.log('\n✅ All utils tests passed!');
    return true;
  } catch (error) {
    console.error(`\n❌ Test failed: ${error.message}`);
    console.error(error.stack);
    return false;
  }
}

// Export for use by other test files
module.exports = { runUtilsTests };

// Run tests if called directly
if (require.main === module) {
  process.exit(runUtilsTests() ? 0 : 1);
}