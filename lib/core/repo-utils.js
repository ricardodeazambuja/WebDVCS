/**
 * Repository Utilities - Pure functions for repository operations
 * These functions have no instance state dependencies
 */

const fs = require('fs');
const { hashData } = require('./utils');
const { diffLines, formatDiff } = require('./diff');
const { getFile } = require('./file-storage');

/**
 * Compare if two files are equal - optimized version using hash comparison
 * Falls back to byte comparison only if hashes are equal (very rare)
 */
function areFilesEqual(file1, file2) {
  if (!file1 && !file2) return true;
  if (!file1 || !file2) return false;

  // Quick length check before expensive operations
  if (file1.length !== file2.length) return false;

  // Fast path: compare hashes first (99.99% of cases will exit here)
  const hash1 = hashData(file1);
  const hash2 = hashData(file2);

  if (hash1 !== hash2) return false;

  // Extremely rare: hashes match but need to verify content
  // (only needed to handle theoretical hash collisions)
  for (let i = 0; i < file1.length; i++) {
    if (file1[i] !== file2[i]) return false;
  }
  return true;
}

/**
 * Generate diff for added file
 */
function generateAddDiff(fileName, content) {
  const lines = new TextDecoder().decode(content).split('\n');
  let diff = '';

  lines.forEach((line, index) => {
    diff += `+${line}\n`;
  });

  return diff;
}

/**
 * Generate diff for modified file
 */
function generateModifyDiff(fileName, oldContent, newContent) {

  const oldText = new TextDecoder().decode(oldContent);
  const newText = new TextDecoder().decode(newContent);

  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');

  const diffResult = diffLines(oldLines, newLines);
  return formatDiff(diffResult);
}

/**
 * Generate diff for deleted file
 */
function generateDeleteDiff(fileName, content) {
  const lines = new TextDecoder().decode(content).split('\n');
  let diff = '';

  lines.forEach((line, index) => {
    diff += `-${line}\n`;
  });

  return diff;
}

/**
 * Get file size from hash
 */
function getFileSizeFromHash(hash, store) {
  try {
    const fileContent = getFile(hash, store);
    return fileContent ? fileContent.length : 0;
  } catch {
    return 0;
  }
}

/**
 * Get detailed storage analytics
 */
function storageAnalytics(store) {
  // Use existing database connection instead of opening a new one
  const db = store.db;

  // Get chunk statistics
  const chunkStats = db.prepare(`
    SELECT
      COUNT(*) as total_chunks,
      SUM(size) as total_data_size,
      AVG(size) as avg_chunk_size,
      MIN(size) as min_chunk_size,
      MAX(size) as max_chunk_size,
      SUM(LENGTH(hash) + size + 16) as estimated_chunk_overhead
    FROM chunks
  `).get();

  // Get size distribution
  const sizeDistribution = db.prepare(`
    SELECT
      CASE
        WHEN size <= 1024 THEN '≤1KB'
        WHEN size <= 4096 THEN '1-4KB'
        WHEN size <= 16384 THEN '4-16KB'
        WHEN size <= 65536 THEN '16-64KB'
        ELSE '>64KB'
      END as size_range,
      COUNT(*) as chunk_count,
      SUM(size) as total_size
    FROM chunks
    GROUP BY size_range
    ORDER BY MIN(size)
  `).all();

  // Get staging area metadata size
  const stagingMeta = store.getMeta('staging_area') || {};
  const stagingSize = JSON.stringify(stagingMeta).length;

  // Get file metadata size
  const fileMeta = store.getMeta('file_metadata') || {};
  const fileMetaSize = JSON.stringify(fileMeta).length;

  // Calculate database file size
  const dbFileSize = fs.statSync(store.dbPath).size;

  // Calculate efficiency metrics
  const dataSize = chunkStats.total_data_size || 0;
  const overhead = dbFileSize - dataSize;
  const efficiency = dataSize > 0 ? (dataSize / dbFileSize * 100) : 0;

  return {
    database: {
      file_path: store.dbPath,
      file_size_bytes: dbFileSize,
      file_size_mb: (dbFileSize / 1024 / 1024).toFixed(2)
    },
    chunks: {
      total_count: chunkStats.total_chunks || 0,
      total_data_size_bytes: dataSize,
      total_data_size_mb: (dataSize / 1024 / 1024).toFixed(2),
      avg_chunk_size_bytes: Math.round(chunkStats.avg_chunk_size || 0),
      min_chunk_size_bytes: chunkStats.min_chunk_size || 0,
      max_chunk_size_bytes: chunkStats.max_chunk_size || 0,
      estimated_metadata_overhead_bytes: chunkStats.estimated_chunk_overhead || 0
    },
    size_distribution: sizeDistribution,
    metadata: {
      staging_area_size_bytes: stagingSize,
      file_metadata_size_bytes: fileMetaSize
    },
    efficiency: {
      data_efficiency_percent: efficiency.toFixed(1),
      overhead_bytes: overhead,
      overhead_mb: (overhead / 1024 / 1024).toFixed(2),
      overhead_ratio: dataSize > 0 ? (overhead / dataSize).toFixed(2) : 'N/A'
    }
  };
}

module.exports = {
  areFilesEqual,
  generateAddDiff,
  generateModifyDiff,
  generateDeleteDiff,
  getFileSizeFromHash,
  storageAnalytics
};