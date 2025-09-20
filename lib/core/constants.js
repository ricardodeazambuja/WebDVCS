/**
 * WebDVCS Core Constants
 * Centralized configuration values and thresholds used throughout the system
 */

/**
 * Binary Detection Constants
 */
// Size of buffer to check for binary content detection (like Git)
// Git checks first 8KB to determine if file is binary
const BINARY_DETECTION_BUFFER_SIZE = 8192; // 8KB

// Threshold for determining if content is binary based on printable character ratio
// If less than 85% of characters are printable, consider it binary
const BINARY_PRINTABLE_RATIO_THRESHOLD = 0.85;

/**
 * Delta Compression Constants
 */
// Only use delta compression when compressed size < 80% of original (20% minimum savings)
// This prevents delta compression when it doesn't provide meaningful space savings
const DELTA_EFFICIENCY_THRESHOLD = 0.8;

// Professional librsync/Git-style delta compression constants
const DELTA_BLOCK_SIZE = 64;           // 64-byte blocks (librsync standard)
const DELTA_MIN_MATCH_LENGTH = 32;     // Minimum match worth encoding (block-based)

// Adler32 rolling checksum constants (industry standard)
const ADLER32_BASE = 65521;            // Largest prime less than 65536
const ADLER32_NMAX = 5552;             // Max number of operations before mod needed

// Strong hash selection (librsync compatible)
const STRONG_HASH_ALGORITHM = 'blake2b'; // Modern alternative to MD4

// Rolling hash constants for old implementation (will be replaced)
const DELTA_ROLLING_HASH_WINDOW = 64;     // Window size for rolling hash
const DELTA_ROLLING_HASH_BASE = 31;       // Base for polynomial rolling hash
const DELTA_ROLLING_HASH_MOD = 1000000007; // Large prime modulus

/**
 * Storage and Performance Constants
 */
// Hash validation - expected length of SHA-256 hash in hexadecimal
const HASH_LENGTH = 64;

// File size thresholds for different processing strategies
const SMALL_FILE_THRESHOLD = 1024; // 1KB - files smaller than this use different strategies
const LARGE_FILE_THRESHOLD = 100 * 1024 * 1024; // 100MB - files larger than this may need special handling

/**
 * Archive Processing Constants (for simple-archive.js)
 */
// Maximum number of files to extract from a single archive
const MAX_ARCHIVE_INTERNAL_FILES = 100;

// Maximum size of archive file to process (prevent memory issues)
const MAX_ARCHIVE_SIZE = 50 * 1024 * 1024; // 50MB

module.exports = {
  // Binary Detection
  BINARY_DETECTION_BUFFER_SIZE,
  BINARY_PRINTABLE_RATIO_THRESHOLD,

  // Delta Compression
  DELTA_EFFICIENCY_THRESHOLD,
  DELTA_BLOCK_SIZE,
  DELTA_MIN_MATCH_LENGTH,
  ADLER32_BASE,
  ADLER32_NMAX,
  STRONG_HASH_ALGORITHM,
  DELTA_ROLLING_HASH_WINDOW,
  DELTA_ROLLING_HASH_BASE,
  DELTA_ROLLING_HASH_MOD,

  // Storage
  HASH_LENGTH,
  SMALL_FILE_THRESHOLD,
  LARGE_FILE_THRESHOLD,

  // Archive Processing
  MAX_ARCHIVE_INTERNAL_FILES,
  MAX_ARCHIVE_SIZE
};