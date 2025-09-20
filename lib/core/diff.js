/**
 * File comparison and diff generation
 */

const { isBinary } = require('./utils');

function diffLines(linesA, linesB) {
  const result = [];
  let i = 0, j = 0;
  
  while (i < linesA.length || j < linesB.length) {
    if (i >= linesA.length) {
      // Remaining lines are additions
      result.push({ type: 'added', line: linesB[j], lineNum: j + 1 });
      j++;
    } else if (j >= linesB.length) {
      // Remaining lines are deletions
      result.push({ type: 'removed', line: linesA[i], lineNum: i + 1 });
      i++;
    } else if (linesA[i] === linesB[j]) {
      // Lines are the same
      result.push({ type: 'context', line: linesA[i], lineNumA: i + 1, lineNumB: j + 1 });
      i++;
      j++;
    } else {
      // Lines differ - mark as removed and added
      result.push({ type: 'removed', line: linesA[i], lineNum: i + 1 });
      result.push({ type: 'added', line: linesB[j], lineNum: j + 1 });
      i++;
      j++;
    }
  }
  
  return result;
}

function formatDiff(diffResult, contextLines = 3) {
  if (diffResult.length === 0) {
    return 'Files are identical';
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
      output.push(`- ${item.line}`);
    } else if (item.type === 'added') {
      output.push(`+ ${item.line}`);
    }
  }
  
  return output.join('\n');
}

function diffFiles(fileA, fileB, nameA = 'file A', nameB = 'file B') {
  // Check if files are identical
  if (fileA.length === fileB.length && fileA.every((byte, i) => byte === fileB[i])) {
    return {
      type: 'identical',
      content: 'Files are identical'
    };
  }
  
  // Check if either file is binary
  const isABinary = isBinary(fileA, nameA);
  const isBBinary = isBinary(fileB, nameB);
  
  if (isABinary || isBBinary) {
    let binaryNote = '';
    if (isABinary && isBBinary) {
      binaryNote = 'Both files are binary';
    } else if (isABinary) {
      binaryNote = `${nameA} is binary`;
    } else {
      binaryNote = `${nameB} is binary`;
    }
    
    return {
      type: 'binary',
      content: [
        `--- ${nameA}`,
        `+++ ${nameB}`,
        `Binary files differ (${fileA.length} vs ${fileB.length} bytes)`,
        `Note: ${binaryNote}`
      ].join('\n'),
      sizeA: fileA.length,
      sizeB: fileB.length,
      binaryNote: binaryNote
    };
  }
  
  // Both files are text - do line-based diff
  const textA = new TextDecoder().decode(fileA);
  const textB = new TextDecoder().decode(fileB);
  
  const linesA = textA.split('\n');
  const linesB = textB.split('\n');
  
  const diffResult = diffLines(linesA, linesB);
  const formattedDiff = formatDiff(diffResult);
  
  return {
    type: 'text',
    content: [
      `--- ${nameA}`,
      `+++ ${nameB}`,
      formattedDiff
    ].join('\n'),
    lines: diffResult
  };
}

function getDiffSummary(fileA, fileB) {
  if (isBinary(fileA) || isBinary(fileB)) {
    return {
      type: 'binary',
      sizeA: fileA.length,
      sizeB: fileB.length,
      changed: fileA.length !== fileB.length || !fileA.every((byte, i) => byte === fileB[i])
    };
  }
  
  const textA = new TextDecoder().decode(fileA);
  const textB = new TextDecoder().decode(fileB);
  const linesA = textA.split('\n');
  const linesB = textB.split('\n');
  
  const diffResult = diffLines(linesA, linesB);
  
  let added = 0, removed = 0, context = 0;
  for (const item of diffResult) {
    if (item.type === 'added') added++;
    else if (item.type === 'removed') removed++;
    else if (item.type === 'context') context++;
  }
  
  return {
    type: 'text',
    linesA: linesA.length,
    linesB: linesB.length,
    added,
    removed,
    context,
    changed: added > 0 || removed > 0
  };
}

module.exports = {
  diffLines,
  formatDiff,
  diffFiles,
  getDiffSummary
};