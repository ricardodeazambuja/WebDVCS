/**
 * CLI Diff - Terminal-formatted diff output with colors
 */

const { diffFiles: coreDiffFiles, formatDiff: coreFormatDiff } = require('../core/diff');
const { colorize } = require('./cli-colors');

/**
 * Format diff result with ANSI colors for terminal display
 * @param {Array} diffResult - Result from core diffLines
 * @param {number} contextLines - Number of context lines to show
 * @returns {string} Colored formatted diff output
 */
function formatDiff(diffResult, contextLines = 3) {
  if (diffResult.length === 0) {
    return colorize('Files are identical', 'context');
  }
  
  const output = [];
  
  // Find chunks of changes with context
  for (let i = 0; i < diffResult.length; i++) {
    const item = diffResult[i];
    
    if (item.type === 'context') {
      // Only show context lines near changes
      const hasChangesNearby = (
        (i > 0 && diffResult[i-1].type !== 'context') ||
        (i < diffResult.length - 1 && diffResult[i+1].type !== 'context')
      );
      
      if (hasChangesNearby) {
        output.push(`  ${item.line}`);
      }
    } else if (item.type === 'removed') {
      output.push(colorize(`- ${item.line}`, 'removed'));
    } else if (item.type === 'added') {
      output.push(colorize(`+ ${item.line}`, 'added'));
    }
  }
  
  return output.join('\n');
}

/**
 * Compare two files and generate colored diff for terminal
 * @param {Uint8Array} fileA - First file data
 * @param {Uint8Array} fileB - Second file data
 * @param {string} nameA - Name of first file
 * @param {string} nameB - Name of second file
 * @returns {string} Colored formatted diff output
 */
function diffFiles(fileA, fileB, nameA = 'file A', nameB = 'file B') {
  const coreResult = coreDiffFiles(fileA, fileB, nameA, nameB);
  
  if (coreResult.type === 'identical') {
    return colorize('Files are identical', 'context');
  }
  
  if (coreResult.type === 'binary') {
    return [
      colorize(`--- ${nameA}`, 'header'),
      colorize(`+++ ${nameB}`, 'header'),
      colorize(`Binary files differ (${coreResult.sizeA} vs ${coreResult.sizeB} bytes)`, 'binary'),
      colorize(`Note: ${coreResult.binaryNote}`, 'binary')
    ].join('\n');
  }
  
  if (coreResult.type === 'text') {
    const formattedDiff = formatDiff(coreResult.lines);
    return [
      colorize(`--- ${nameA}`, 'header'),
      colorize(`+++ ${nameB}`, 'header'),
      formattedDiff
    ].join('\n');
  }
  
  return coreResult.content;
}

module.exports = {
  formatDiff,
  diffFiles
};