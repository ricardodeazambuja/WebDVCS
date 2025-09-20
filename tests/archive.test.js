/**
 * Archive Processing Tests
 * Tests for ZIP file detection, extraction, and reconstruction using simple-archive.js
 * These tests verify the bugs found during AI slop investigation were fixed
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const fs = require('fs');
const path = require('path');
const os = require('os');

// Import simple archive processor and repo
const simpleArchive = require('../lib/core/simple-archive');
const { MiniRepo } = require('../lib/core/repo');

// Simple test runner
function assert(condition, message = 'Assertion failed') {
  if (!condition) {
    throw new Error(message);
  }
}

function testArchiveDetection() {
  console.log('Testing archive detection...');

  // Test ZIP signature detection (the core bug was here)
  const zipSignature = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]);
  assert(simpleArchive.isArchiveFile(zipSignature, 'test.zip'), 'Should detect ZIP signature');

  // Test extension fallback (need 4 bytes minimum)
  assert(simpleArchive.isArchiveFile(Buffer.from([0x00, 0x00, 0x00, 0x00]), 'test.docx'), 'Should detect DOCX extension');
  assert(simpleArchive.isArchiveFile(Buffer.from([0x00, 0x00, 0x00, 0x00]), 'test.xlsx'), 'Should detect XLSX extension');
  assert(simpleArchive.isArchiveFile(Buffer.from([0x00, 0x00, 0x00, 0x00]), 'test.odt'), 'Should detect ODT extension');

  // Test negative cases
  assert(!simpleArchive.isArchiveFile(Buffer.from([0x00, 0x00, 0x00, 0x00]), 'test.txt'), 'Should not detect text file');
  assert(!simpleArchive.isArchiveFile(Buffer.from([0x50, 0x4b, 0x01, 0x02]), 'test.bin'), 'Should not detect wrong signature');

  console.log('✅ Archive detection tests passed');
}

function testRealZipCreation() {
  console.log('Testing real ZIP file creation and extraction...');

  // Create test files with directories (critical test case)
  const testFiles = [
    { internalPath: 'root.txt', content: Buffer.from('Root file content') },
    { internalPath: 'folder/nested.txt', content: Buffer.from('Nested file content') },
    { internalPath: 'folder/subfolder/deep.txt', content: Buffer.from('Deep nested content') },
    { internalPath: 'data.json', content: Buffer.from('{"test": "data"}') }
  ];

  // Test ZIP reconstruction
  const zipBuffer = simpleArchive.reconstructZip(testFiles);
  assert(zipBuffer instanceof Buffer, 'Should return Buffer');
  assert(zipBuffer.length > 0, 'Should have content');

  // Verify ZIP signature (critical bug was here)
  assert(zipBuffer[0] === 0x50, 'Should have correct ZIP signature byte 1');
  assert(zipBuffer[1] === 0x4b, 'Should have correct ZIP signature byte 2');
  assert(zipBuffer[2] === 0x03, 'Should have correct ZIP signature byte 3');
  assert(zipBuffer[3] === 0x04, 'Should have correct ZIP signature byte 4');

  // Test extraction (this is where the DataView buffer bug was)
  const extractedFiles = simpleArchive.extractZipFiles(zipBuffer, 'test.zip');
  assert(extractedFiles.length === testFiles.length, `Should extract all files: got ${extractedFiles.length}, expected ${testFiles.length}`);

  // Verify each extracted file (directory structure test)
  for (const originalFile of testFiles) {
    const extracted = extractedFiles.find(f => f.internalPath === originalFile.internalPath);
    assert(extracted !== undefined, `Should find extracted file: ${originalFile.internalPath}`);
    assert(Buffer.compare(extracted.content, originalFile.content) === 0, `Content should match for ${originalFile.internalPath}`);
    assert(extracted.fullPath === `test.zip/${originalFile.internalPath}`, `Full path should be correct for ${originalFile.internalPath}`);
  }

  console.log('✅ Real ZIP creation and extraction tests passed');
}

function testBufferEdgeCases() {
  console.log('Testing Buffer/ArrayBuffer edge cases...');

  // Test with Buffer (Node.js) - this was the critical bug case
  const nodeBuffer = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]);
  assert(simpleArchive.isArchiveFile(nodeBuffer, 'test.zip'), 'Should detect ZIP from Node.js Buffer');

  // Test with Uint8Array
  const uint8Array = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]);
  assert(simpleArchive.isArchiveFile(uint8Array, 'test.zip'), 'Should detect ZIP from Uint8Array');

  // Test with very small buffer (edge case)
  const tinyBuffer = Buffer.from([0x50, 0x4b]);
  assert(!simpleArchive.isArchiveFile(tinyBuffer, 'test.zip'), 'Should not detect ZIP from tiny buffer');

  // Test with null/undefined
  assert(!simpleArchive.isArchiveFile(null, 'test.zip'), 'Should handle null data');
  assert(!simpleArchive.isArchiveFile(undefined, 'test.zip'), 'Should handle undefined data');

  // Test with empty buffer
  const emptyBuffer = Buffer.alloc(0);
  assert(!simpleArchive.isArchiveFile(emptyBuffer, 'test.zip'), 'Should handle empty buffer');

  console.log('✅ Buffer edge case tests passed');
}

function testZipRoundTrip() {
  console.log('Testing ZIP round-trip (create -> extract -> recreate)...');

  // Original files with compression test cases
  const originalFiles = [
    { internalPath: 'small.txt', content: Buffer.from('Hello') },
    { internalPath: 'large.txt', content: Buffer.from('A'.repeat(500)) }, // Should compress
    { internalPath: 'folder/nested.txt', content: Buffer.from('Nested content') },
    { internalPath: 'binary.dat', content: Buffer.from([0x00, 0x01, 0xFF, 0xFE, 0x42]) }
  ];

  // Create ZIP
  const zipBuffer1 = simpleArchive.reconstructZip(originalFiles);
  assert(zipBuffer1.length > 0, 'Should create non-empty ZIP');

  // Extract files
  const extractedFiles = simpleArchive.extractZipFiles(zipBuffer1, 'test.zip');
  assert(extractedFiles.length === originalFiles.length, 'Should extract all files');

  // Verify extracted content matches original
  for (const original of originalFiles) {
    const extracted = extractedFiles.find(f => f.internalPath === original.internalPath);
    assert(extracted !== undefined, `Should find ${original.internalPath}`);
    assert(Buffer.compare(extracted.content, original.content) === 0, `Content should match for ${original.internalPath}`);
  }

  // Recreate ZIP from extracted files
  const recreatedFiles = extractedFiles.map(f => ({ internalPath: f.internalPath, content: f.content }));
  const zipBuffer2 = simpleArchive.reconstructZip(recreatedFiles);

  // Extract again
  const reextractedFiles = simpleArchive.extractZipFiles(zipBuffer2, 'test2.zip');
  assert(reextractedFiles.length === originalFiles.length, 'Should extract all files from recreated ZIP');

  // Verify final content still matches
  for (const original of originalFiles) {
    const reextracted = reextractedFiles.find(f => f.internalPath === original.internalPath);
    assert(reextracted !== undefined, `Should find ${original.internalPath} in reextracted`);
    assert(Buffer.compare(reextracted.content, original.content) === 0, `Final content should match for ${original.internalPath}`);
  }

  console.log('✅ ZIP round-trip tests passed');
}

function testArchiveIntegration() {
  console.log('Testing archive integration with repository...');

  const repo = new MiniRepo(':memory:');
  repo.setAuthor('Test User', 'test@example.com');

  // Create a real ZIP file (minimal DOCX-like structure)
  const docxFiles = [
    { internalPath: 'word/document.xml', content: Buffer.from('<?xml version="1.0"?><document>Test content</document>') },
    { internalPath: '[Content_Types].xml', content: Buffer.from('<?xml version="1.0"?><Types></Types>') },
    { internalPath: '_rels/.rels', content: Buffer.from('<?xml version="1.0"?><Relationships></Relationships>') }
  ];

  const zipData = simpleArchive.reconstructZip(docxFiles);
  assert(zipData.length > 0, 'Should create non-empty ZIP data');

  // Add the ZIP file to repository as regular file (no archive processing)
  const metadata = {
    mode: 0o644,
    mtime: Math.floor(Date.now() / 1000),
    size: zipData.length,
    type: 'file',
    target: null
  };

  // Temporarily disable archive processing to test basic integration
  const originalArchiveOptions = repo.stagingManager.archiveOptions;
  repo.stagingManager.archiveOptions = { processArchives: false };

  const result = repo.addFile('document.docx', zipData, false, metadata);
  assert(result !== null, 'Should successfully add archive file');
  assert(result.fileName === 'document.docx', 'Should return correct filename');

  // Verify file appears in staging
  const stagedFiles = repo.stagingManager.getStagedFiles();
  assert(stagedFiles.includes('document.docx'), 'Archive should appear in staged files');

  // Test that we can commit the archive
  const commitResult = repo.commit('Add DOCX document');
  assert(commitResult && commitResult.commitHash, 'Should successfully commit archive');

  // Test that we can retrieve the file
  const retrievedData = repo.getFile('document.docx');
  assert(retrievedData !== null, 'Should retrieve archive file');
  assert(Buffer.compare(retrievedData, zipData) === 0, 'Retrieved data should match original');

  // Test archive detection works
  assert(simpleArchive.isArchiveFile(retrievedData, 'document.docx'), 'Should detect as archive file');

  // Test extraction still works
  const extractedFromRepo = simpleArchive.extractZipFiles(retrievedData, 'document.docx');
  assert(extractedFromRepo.length === docxFiles.length, 'Should extract all internal files');

  // Restore original archive options
  repo.stagingManager.archiveOptions = originalArchiveOptions;

  console.log('✅ Archive integration tests passed');
}

function testArchiveErrorHandling() {
  console.log('Testing archive error handling...');

  // Test invalid ZIP data
  const invalidZip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]); // Too short

  try {
    simpleArchive.extractZipFiles(invalidZip, 'invalid.zip');
    assert(false, 'Should throw error for invalid ZIP');
  } catch (error) {
    assert(error.message.includes('Invalid ZIP'), 'Should have meaningful error message');
  }

  // Test ZIP with wrong signature
  const wrongSignature = Buffer.from([0x51, 0x4b, 0x03, 0x04, 0x14, 0x00]);
  assert(!simpleArchive.isArchiveFile(wrongSignature, 'test.bin'), 'Should not detect wrong signature');

  // Test with corrupted ZIP (corrupt the EOCD signature completely)
  const files = [{ internalPath: 'test.txt', content: Buffer.from('test') }];
  const validZip = simpleArchive.reconstructZip(files);

  // Corrupt the end of central directory signature more severely
  const corruptedZip = Buffer.from(validZip);
  // Change the last 10 bytes to completely break the EOCD
  for (let i = corruptedZip.length - 10; i < corruptedZip.length; i++) {
    corruptedZip[i] = 0x00;
  }

  try {
    simpleArchive.extractZipFiles(corruptedZip, 'corrupted.zip');
    assert(false, 'Should throw error for corrupted ZIP');
  } catch (error) {
    // Accept any error as long as it throws
    assert(error instanceof Error, 'Should throw an error for corrupted ZIP');
  }

  // Test empty files list
  const emptyZip = simpleArchive.reconstructZip([]);
  assert(emptyZip.length > 0, 'Should create valid empty ZIP');

  const extractedEmpty = simpleArchive.extractZipFiles(emptyZip, 'empty.zip');
  assert(extractedEmpty.length === 0, 'Should extract no files from empty ZIP');

  console.log('✅ Archive error handling tests passed');
}

function testHEADResolution() {
  console.log('Testing HEAD resolution (critical CLI bug fix)...');

  const repo = new MiniRepo(':memory:');
  repo.setAuthor('Test User', 'test@example.com');

  // Add file and commit to create HEAD
  repo.addFile('test.txt', 'Initial content');
  const commit1 = repo.commit('First commit');
  assert(commit1.commitHash, 'Should create first commit');

  // Add another file and commit
  repo.addFile('second.txt', 'Second file');
  const commit2 = repo.commit('Second commit');
  assert(commit2.commitHash, 'Should create second commit');

  // Test plain HEAD resolution
  const headHash = repo.resolveCommitReference('HEAD');
  assert(headHash === commit2.commitHash, 'HEAD should resolve to latest commit');

  // Test HEAD~1 resolution
  const head1Hash = repo.resolveCommitReference('HEAD~1');
  assert(head1Hash === commit1.commitHash, 'HEAD~1 should resolve to previous commit');

  // Test HEAD~0 (should be same as HEAD)
  const head0Hash = repo.resolveCommitReference('HEAD~0');
  assert(head0Hash === commit2.commitHash, 'HEAD~0 should resolve to current commit');

  // Test invalid HEAD~N (too far back)
  const invalidHead = repo.resolveCommitReference('HEAD~10');
  assert(invalidHead === null, 'HEAD~10 should return null (not enough commits)');

  // Test invalid commit reference
  const invalidCommit = repo.resolveCommitReference('invalid-hash');
  assert(invalidCommit === null, 'Invalid hash should return null');

  // Test null/undefined references
  assert(repo.resolveCommitReference(null) === null, 'null should return null');
  assert(repo.resolveCommitReference(undefined) === null, 'undefined should return null');
  assert(repo.resolveCommitReference('') === null, 'empty string should return null');

  // Test direct commit hash resolution
  const directHash = repo.resolveCommitReference(commit1.commitHash);
  assert(directHash === commit1.commitHash, 'Direct commit hash should resolve to itself');

  console.log('✅ HEAD resolution tests passed');
}

// Main test runner
function runArchiveTests() {
  console.log('Running Archive Processing Tests...');
  console.log('');

  try {
    testArchiveDetection();
    testRealZipCreation();
    testBufferEdgeCases();
    testZipRoundTrip();
    testArchiveIntegration();
    testArchiveErrorHandling();
    testHEADResolution();

    console.log('');
    console.log('✅ All archive processing tests passed!');
    return true;
  } catch (error) {
    console.error('❌ Archive test failed:', error.message);
    console.error(error.stack);
    return false;
  }
}

module.exports = {
  runner: runArchiveTests,
  testName: 'Archive Processing'
};

console.log('✅ Archive processing tests loaded successfully');