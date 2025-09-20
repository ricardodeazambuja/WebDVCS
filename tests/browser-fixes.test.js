/**
 * Browser Fixes Test - Tests for specific browser issues that were fixed
 * Tests async file retrieval and branch import/export
 */

const { MiniRepo } = require('../lib/core/repo');
const path = require('path');
const fs = require('fs');

function testAsyncFileRetrieval() {
  console.log('Testing async file retrieval (getFileFromCommit)...');

  const repo = new MiniRepo(':memory:');
  repo.setAuthor('Test User', 'test@example.com');

  // Add and commit a file
  const testContent = 'This is test content for async retrieval';
  repo.addFile('async-test.txt', Buffer.from(testContent));
  const commit = repo.commit('Test async file retrieval');

  // Test synchronous method that browser was incorrectly treating as async
  const fileContent = repo.getFile('async-test.txt', commit.commitHash);

  if (!fileContent) {
    throw new Error('Failed to retrieve file content');
  }

  const retrievedText = new TextDecoder().decode(fileContent);
  if (retrievedText !== testContent) {
    throw new Error(`Content mismatch: expected "${testContent}", got "${retrievedText}"`);
  }

  console.log('✅ Async file retrieval test passed');
}

function testBranchImportWithBinaryFiles() {
  console.log('Testing branch import with binary files...');

  // Create source repository with binary content
  const sourceRepo = new MiniRepo(':memory:');
  sourceRepo.setAuthor('Alice', 'alice@example.com');

  // Add text file
  sourceRepo.addFile('text.txt', Buffer.from('Text content'));

  // Add binary file (simulate image data)
  const binaryData = new Uint8Array([
    0x89, 0x50, 0x4E, 0x47, // PNG signature
    0x0D, 0x0A, 0x1A, 0x0A,
    0x00, 0x00, 0x00, 0x0D,
    0x49, 0x48, 0x44, 0x52,
    // ... more binary data
    0xFF, 0xFE, 0xFD, 0xFC
  ]);
  sourceRepo.addFile('image.png', binaryData, true);

  // Add another text file with special characters
  const specialText = 'Special chars: 你好 мир 🚀 \n\t\r';
  sourceRepo.addFile('special.txt', Buffer.from(specialText));

  const initialCommit = sourceRepo.commit('Initial with binary');

  // Create feature branch
  sourceRepo.createBranch('binary-feature');
  sourceRepo.switchBranch('binary-feature');

  // Add more files
  sourceRepo.addFile('feature.js', Buffer.from('function test() { return true; }'));

  // Add large binary file to test compression
  const largeData = new Uint8Array(10000);
  for (let i = 0; i < largeData.length; i++) {
    largeData[i] = i % 256;
  }
  sourceRepo.addFile('large.bin', largeData, true);

  sourceRepo.commit('Add feature with large binary');

  // Export the branch
  console.log('  Exporting branch with binary files...');
  const exportData = sourceRepo.exportBranchToFile('binary-feature');

  if (!exportData || !exportData.data) {
    throw new Error('Export failed - no data returned');
  }

  // Create target repository
  const targetRepo = new MiniRepo(':memory:');
  targetRepo.setAuthor('Bob', 'bob@example.com');

  // Add different base to ensure no conflicts
  targetRepo.addFile('base.txt', Buffer.from('Different base'));
  targetRepo.commit('Target base');

  // Import the branch
  console.log('  Importing branch with binary files...');
  const importStats = targetRepo.importBranchFromFile(exportData.data);

  if (importStats.commits_imported === 0) {
    throw new Error('No commits imported');
  }

  if (importStats.blobs_imported === 0 && importStats.skipped_existing === 0) {
    throw new Error('No blobs imported or skipped');
  }

  console.log(`  Imported: ${importStats.commits_imported} commits, ${importStats.blobs_imported} blobs`);

  // Switch to imported branch and verify content
  targetRepo.switchBranch('binary-feature');

  // Verify text file
  const textContent = targetRepo.cat('text.txt');
  if (new TextDecoder().decode(textContent) !== 'Text content') {
    throw new Error('Text file content mismatch after import');
  }

  // Verify binary file
  const importedBinary = targetRepo.cat('image.png');
  if (importedBinary.length !== binaryData.length) {
    throw new Error(`Binary file size mismatch: expected ${binaryData.length}, got ${importedBinary.length}`);
  }

  for (let i = 0; i < binaryData.length; i++) {
    if (importedBinary[i] !== binaryData[i]) {
      throw new Error(`Binary data mismatch at byte ${i}`);
    }
  }

  // Verify special characters
  const importedSpecial = targetRepo.cat('special.txt');
  if (new TextDecoder().decode(importedSpecial) !== specialText) {
    throw new Error('Special characters not preserved in import');
  }

  // Verify large binary
  const importedLarge = targetRepo.cat('large.bin');
  if (importedLarge.length !== largeData.length) {
    throw new Error('Large binary file size mismatch');
  }

  console.log('✅ Branch import with binary files test passed');
}

function testBranchImportErrorHandling() {
  console.log('Testing branch import error handling...');

  const repo = new MiniRepo(':memory:');
  repo.setAuthor('Test', 'test@example.com');

  // Test importing invalid data
  try {
    const invalidData = new Uint8Array([1, 2, 3, 4]); // Not a valid SQLite file
    repo.importBranchFromFile(invalidData);
    throw new Error('Should have thrown error for invalid SQLite data');
  } catch (error) {
    if (!error.message.includes('Invalid SQLite database format')) {
      throw new Error(`Unexpected error: ${error.message}`);
    }
  }

  // Test importing empty data
  try {
    repo.importBranchFromFile(new Uint8Array(0));
    throw new Error('Should have thrown error for empty data');
  } catch (error) {
    // Expected to fail
  }

  console.log('✅ Branch import error handling test passed');
}

function testBufferUint8ArrayCompatibility() {
  console.log('Testing Buffer/Uint8Array compatibility...');

  const repo = new MiniRepo(':memory:');
  repo.setAuthor('Test', 'test@example.com');

  // Test adding files with different data types
  const buffer = Buffer.from('Buffer content');
  const uint8array = new Uint8Array([85, 105, 110, 116, 56]); // "Uint8"
  const arrayBuffer = new ArrayBuffer(5);
  const view = new Uint8Array(arrayBuffer);
  view.set([65, 114, 114, 97, 121]); // "Array"

  repo.addFile('buffer.txt', buffer);
  repo.addFile('uint8.txt', uint8array);
  repo.addFile('array.txt', view);

  const commit = repo.commit('Test different data types');

  // Retrieve and verify
  const retrievedBuffer = repo.cat('buffer.txt');
  const retrievedUint8 = repo.cat('uint8.txt');
  const retrievedArray = repo.cat('array.txt');

  if (new TextDecoder().decode(retrievedBuffer) !== 'Buffer content') {
    throw new Error('Buffer content mismatch');
  }

  if (new TextDecoder().decode(retrievedUint8) !== 'Uint8') {
    throw new Error('Uint8Array content mismatch');
  }

  if (new TextDecoder().decode(retrievedArray) !== 'Array') {
    throw new Error('ArrayBuffer content mismatch');
  }

  console.log('✅ Buffer/Uint8Array compatibility test passed');
}

// Run all tests
console.log('\n=== Running Browser Fixes Tests ===\n');

try {
  testAsyncFileRetrieval();
  testBranchImportWithBinaryFiles();
  testBranchImportErrorHandling();
  testBufferUint8ArrayCompatibility();

  console.log('\n✅ All browser fixes tests passed!\n');
  process.exit(0);
} catch (error) {
  console.error('\n❌ Test failed:', error.message);
  console.error(error.stack);
  process.exit(1);
}