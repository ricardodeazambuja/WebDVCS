/**
 * Core utility functions
 */

const crypto = require('crypto');
const {
  BINARY_DETECTION_BUFFER_SIZE,
  BINARY_PRINTABLE_RATIO_THRESHOLD
} = require('./constants');

function hashData(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function isBinary(data, filename = '') {
  if (!data || data.length === 0) return false;
  
  // Method 1: Null byte detection (primary method like Git)
  const checkSize = Math.min(data.length, BINARY_DETECTION_BUFFER_SIZE);
  for (let i = 0; i < checkSize; i++) {
    if (data[i] === 0) {
      return true;
    }
  }
  
  // Method 2: Non-printable character ratio (fallback)
  let printable = 0;
  let nonPrintable = 0;
  
  for (let i = 0; i < checkSize; i++) {
    const byte = data[i];
    if ((byte >= 0x20 && byte <= 0x7E) || // Printable ASCII
        byte === 0x09 || byte === 0x0A || byte === 0x0D) { // Tab, LF, CR
      printable++;
    } else if (byte < 0x20 || byte > 0x7E) {
      nonPrintable++;
    }
  }
  
  const total = printable + nonPrintable;
  if (total === 0) return false;
  
  const printableRatio = printable / total;
  return printableRatio < BINARY_PRINTABLE_RATIO_THRESHOLD;
}

function arraysEqual(a, b) {
  return a.length === b.length && a.every((val, i) => val === b[i]);
}

function stringToUint8Array(str) {
  return new TextEncoder().encode(str);
}

function uint8ArrayToString(data) {
  return new TextDecoder().decode(data);
}

module.exports = {
  hashData,
  isBinary,
  arraysEqual,
  stringToUint8Array,
  uint8ArrayToString
};