/**
 * Pure file storage - Fossil-style delta compression on entire files
 * No chunking, no manifests - just direct file delta storage
 */

/**
 * Store a file with delta compression against a base version
 * @param {Uint8Array} data - File content
 * @param {string} fileName - File name (for debugging)
 * @param {SQLiteStore} store - Storage instance
 * @param {string} baseHash - Hash of previous version for delta compression
 * @returns {Object} Storage result with hash and metadata
 */
function storeFile(data, fileName, store, baseHash = null) {
  // Use delta compression if base exists, otherwise store full file
  const result = store.storeBlobWithDelta(data, baseHash);

  return {
    hash: result.hash,
    size: data.length,
    usedDelta: result.usedDelta,
    deltaSize: result.deltaSize,
    compressionRatio: result.compressionRatio,
    reason: result.reason
  };
}

/**
 * Get file content by hash
 * @param {string} hash - Content hash
 * @param {SQLiteStore} store - Storage instance
 * @returns {Uint8Array} File content
 */
function getFile(hash, store) {
  return store.getBlob(hash);
}

/**
 * Check if file exists
 * @param {string} hash - Content hash
 * @param {SQLiteStore} store - Storage instance
 * @returns {boolean} True if file exists
 */
function hasFile(hash, store) {
  return store.hasBlob(hash);
}

module.exports = {
  storeFile,
  getFile,
  hasFile
};