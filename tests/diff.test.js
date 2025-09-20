/**
 * Diff Tests - Real tests for diff functionality
 */

const { diffLines, getDiffSummary } = require('../lib/core/diff');
const { formatDiff, diffFiles } = require('../lib/cli/cli-diff');
const { colorize, diffColors } = require('../lib/cli/cli-colors');
const { stringToUint8Array } = require('../lib/core/utils');

// Simple test runner
function assert(condition, message = 'Assertion failed') {
  if (!condition) {
    throw new Error(message);
  }
}

// Helper to strip ANSI colors for testing
function stripColors(text) {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

function testColorize() {
  console.log('Testing colorize...');
  
  const coloredText = colorize('test text', 'added');
  assert(typeof coloredText === 'string', 'Colorized text should be string');
  assert(coloredText.includes('test text'), 'Should contain original text');
  assert(coloredText.includes(diffColors.added), 'Should contain color code');
  assert(coloredText.includes(diffColors.reset), 'Should contain reset code');
  
  // Test invalid color
  const invalidColor = colorize('test', 'invalid');
  assert(invalidColor.includes('test'), 'Should contain text even with invalid color');
  
  console.log('✅ colorize tests passed');
}

function testDiffLines() {
  console.log('Testing diffLines...');
  
  // Test identical lines
  const linesA = ['line1', 'line2', 'line3'];
  const linesB = ['line1', 'line2', 'line3'];
  const identicalDiff = diffLines(linesA, linesB);
  
  assert(Array.isArray(identicalDiff), 'Diff should be array');
  assert(identicalDiff.length === 3, 'Should have 3 context lines');
  assert(identicalDiff.every(item => item.type === 'context'), 'All should be context');
  
  // Test completely different lines
  const linesC = ['old1', 'old2'];
  const linesD = ['new1', 'new2'];
  const differentDiff = diffLines(linesC, linesD);
  
  assert(differentDiff.length === 4, 'Should have 4 changes (2 removed + 2 added)');
  assert(differentDiff[0].type === 'removed', 'First should be removed');
  assert(differentDiff[0].line === 'old1', 'First should be old1');
  assert(differentDiff[1].type === 'added', 'Second should be added');
  assert(differentDiff[1].line === 'new1', 'Second should be new1');
  
  // Test additions only
  const linesE = ['line1'];
  const linesF = ['line1', 'added'];
  const additionDiff = diffLines(linesE, linesF);
  
  assert(additionDiff.length === 2, 'Should have 2 items');
  assert(additionDiff[0].type === 'context', 'First should be context');
  assert(additionDiff[1].type === 'added', 'Second should be added');
  
  // Test deletions only
  const deletionDiff = diffLines(linesF, linesE);
  assert(deletionDiff[1].type === 'removed', 'Second should be removed');
  
  console.log('✅ diffLines tests passed');
}

function testFormatDiff() {
  console.log('Testing formatDiff...');
  
  // Test empty diff
  const emptyResult = formatDiff([]);
  assert(typeof emptyResult === 'string', 'Should return string');
  assert(stripColors(emptyResult).includes('identical'), 'Should indicate files are identical');
  
  // Test diff with changes
  const diffResult = [
    { type: 'context', line: 'unchanged', lineNumA: 1, lineNumB: 1 },
    { type: 'removed', line: 'old line', lineNum: 2 },
    { type: 'added', line: 'new line', lineNum: 2 },
    { type: 'context', line: 'more context', lineNumA: 3, lineNumB: 3 }
  ];
  
  const formatted = formatDiff(diffResult);
  assert(typeof formatted === 'string', 'Should return string');
  assert(formatted.includes('unchanged'), 'Should include context lines');
  assert(formatted.includes('- old line'), 'Should include removed line with prefix');
  assert(formatted.includes('+ new line'), 'Should include added line with prefix');
  
  console.log('✅ formatDiff tests passed');
}

function testDiffFiles() {
  console.log('Testing diffFiles...');
  
  // Test identical files
  const fileA = stringToUint8Array('line1\nline2\nline3');
  const fileB = stringToUint8Array('line1\nline2\nline3');
  
  const identicalDiff = diffFiles(fileA, fileB, 'fileA.txt', 'fileB.txt');
  assert(stripColors(identicalDiff).includes('identical'), 'Identical files should be noted');
  
  // Test different text files
  const textA = stringToUint8Array('Hello\nWorld');
  const textB = stringToUint8Array('Hello\nUniverse');
  
  const textDiff = diffFiles(textA, textB, 'a.txt', 'b.txt');
  assert(textDiff.includes('--- a.txt'), 'Should include file names in header');
  assert(textDiff.includes('+++ b.txt'), 'Should include file names in header');
  assert(textDiff.includes('- World'), 'Should show removed line');
  assert(textDiff.includes('+ Universe'), 'Should show added line');
  
  // Test binary files
  const binaryA = new Uint8Array([0x00, 0x01, 0x02, 0xFF]);
  const binaryB = new Uint8Array([0x00, 0x01, 0x03, 0xFF]);
  
  const binaryDiff = diffFiles(binaryA, binaryB, 'a.bin', 'b.bin');
  assert(stripColors(binaryDiff).includes('Binary files differ'), 'Should detect binary files');
  assert(stripColors(binaryDiff).includes('4 vs 4 bytes'), 'Should show file sizes');
  
  // Test mixed binary/text
  const mixedDiff = diffFiles(binaryA, textA, 'binary.bin', 'text.txt');
  assert(stripColors(mixedDiff).includes('binary.bin is binary'), 'Should note which file is binary');
  
  console.log('✅ diffFiles tests passed');
}

function testGetDiffSummary() {
  console.log('Testing getDiffSummary...');
  
  // Test text file summary
  const textA = stringToUint8Array('line1\nline2\nline3');
  const textB = stringToUint8Array('line1\nmodified\nline3\nnew line');
  
  const textSummary = getDiffSummary(textA, textB);
  assert(textSummary.type === 'text', 'Should be text type');
  assert(textSummary.linesA === 3, 'Should count lines in A');
  assert(textSummary.linesB === 4, 'Should count lines in B');
  assert(textSummary.removed === 1, 'Should count removed lines');
  assert(textSummary.added === 2, 'Should count added lines');
  assert(textSummary.context === 2, 'Should count context lines');
  assert(textSummary.changed === true, 'Should indicate changes');
  
  // Test binary file summary
  const binaryA = new Uint8Array([0x00, 0x01, 0x02]);
  const binaryB = new Uint8Array([0x00, 0x01, 0x03, 0x04]);
  
  const binarySummary = getDiffSummary(binaryA, binaryB);
  assert(binarySummary.type === 'binary', 'Should be binary type');
  assert(binarySummary.sizeA === 3, 'Should have correct size A');
  assert(binarySummary.sizeB === 4, 'Should have correct size B');
  assert(binarySummary.changed === true, 'Should indicate binary files changed');
  
  // Test identical files
  const identicalSummary = getDiffSummary(textA, textA);
  assert(identicalSummary.changed === false, 'Identical files should not be changed');
  
  console.log('✅ getDiffSummary tests passed');
}

function testMultilineDiff() {
  console.log('Testing multiline diff scenarios...');
  
  // Test file with many changes
  const originalText = 'line1\nline2\nline3\nline4\nline5';
  const modifiedText = 'line1\nmodified2\nline3\nnew4\nline5\nextra';
  
  const original = stringToUint8Array(originalText);
  const modified = stringToUint8Array(modifiedText);
  
  const diff = diffFiles(original, modified, 'original.txt', 'modified.txt');
  assert(diff.includes('- line2'), 'Should show removed line');
  assert(diff.includes('+ modified2'), 'Should show added line');
  assert(diff.includes('- line4'), 'Should show second removed line');
  assert(diff.includes('+ new4'), 'Should show second modified line');
  assert(diff.includes('+ extra'), 'Should show additional line');
  
  const summary = getDiffSummary(original, modified);
  assert(summary.removed === 2, 'Should count 2 removed lines');
  assert(summary.added === 3, 'Should count 3 added lines');
  assert(summary.context === 3, 'Should count 3 context lines');
  
  console.log('✅ Multiline diff tests passed');
}

function testEdgeCases() {
  console.log('Testing edge cases...');
  
  // Test empty files
  const emptyA = new Uint8Array(0);
  const emptyB = new Uint8Array(0);
  
  const emptyDiff = diffFiles(emptyA, emptyB, 'empty1', 'empty2');
  assert(stripColors(emptyDiff).includes('identical'), 'Empty files should be identical');
  
  // Test one empty, one with content
  const content = stringToUint8Array('content');
  const emptyToContent = diffFiles(emptyA, content, 'empty', 'content');
  assert(emptyToContent.includes('+ content'), 'Should show added content');
  
  // Test single line files
  const singleA = stringToUint8Array('single');
  const singleB = stringToUint8Array('changed');
  
  const singleDiff = diffFiles(singleA, singleB, 'a', 'b');
  assert(singleDiff.includes('- single'), 'Should show removed single line');
  assert(singleDiff.includes('+ changed'), 'Should show added single line');
  
  // Test files with only newlines
  const newlinesA = stringToUint8Array('\n\n\n');
  const newlinesB = stringToUint8Array('\n\n');
  
  const newlinesDiff = diffFiles(newlinesA, newlinesB, 'a', 'b');
  assert(typeof newlinesDiff === 'string', 'Newlines diff should return string');
  
  console.log('✅ Edge cases tests passed');
}

function testBinaryDetection() {
  console.log('Testing binary detection in diff...');
  
  // Test clearly binary data (with null bytes)
  const binaryData = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x00, 0x0A, 0x1A, 0x0A]); // PNG header
  const textData = stringToUint8Array('This is text content');
  
  const binaryDiff = diffFiles(binaryData, textData, 'image.png', 'text.txt');
  assert(stripColors(binaryDiff).includes('image.png is binary'), 'Should detect PNG as binary');
  assert(stripColors(binaryDiff).includes('Binary files differ'), 'Should indicate binary diff');
  
  // Test both binary
  const anotherBinary = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0]); // JPEG header
  const bothBinaryDiff = diffFiles(binaryData, anotherBinary, 'a.png', 'b.jpg');
  assert(stripColors(bothBinaryDiff).includes('Both files are binary'), 'Should detect both as binary');
  
  console.log('✅ Binary detection tests passed');
}

// Run all tests
function runDiffTests() {
  console.log('Running Diff Tests...\n');
  
  try {
    testColorize();
    testDiffLines();
    testFormatDiff();
    testDiffFiles();
    testGetDiffSummary();
    testMultilineDiff();
    testEdgeCases();
    testBinaryDetection();
    
    console.log('\n✅ All diff tests passed!');
    return true;
  } catch (error) {
    console.error(`\n❌ Test failed: ${error.message}`);
    console.error(error.stack);
    return false;
  }
}

// Export for use by other test files
module.exports = { runDiffTests };

// Run tests if called directly
if (require.main === module) {
  process.exit(runDiffTests() ? 0 : 1);
}