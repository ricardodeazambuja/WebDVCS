/**
 * Delta Test Helpers
 * Utility functions for verifying delta compression functionality
 */

const { hashData } = require('../../lib/core/utils');

class DeltaTestHelpers {
  /**
   * Assert that delta compression was used in storage result
   * @param {Object} result - Result from storeBlobWithDelta()
   * @param {string} expectedReason - Expected reason if delta wasn't used
   */
  static assertDeltaUsed(result, expectedReason = null) {
    if (expectedReason) {
      console.assert(result.usedDelta === false, 'Expected delta NOT to be used');
      console.assert(result.reason === expectedReason, `Expected reason: ${expectedReason}, got: ${result.reason}`);
    } else {
      console.assert(result.usedDelta === true, 'Expected delta compression to be used');
      console.assert(result.deltaSize > 0, 'Delta should have positive size');
    }
  }

  /**
   * Assert compression ratio meets expectations
   * @param {Object} result - Result from storeBlobWithDelta()
   * @param {number} expectedRatio - Expected compression ratio (0-1)
   * @param {number} tolerance - Tolerance for ratio comparison
   */
  static assertCompressionRatio(result, expectedRatio, tolerance = 0.1) {
    const actualRatio = result.compressionRatio;
    console.assert(
      Math.abs(actualRatio - expectedRatio) <= tolerance,
      `Expected compression ratio ~${expectedRatio}, got ${actualRatio} (tolerance: ${tolerance})`
    );
  }

  /**
   * Verify data integrity between original and reconstructed data
   * @param {Uint8Array} original - Original data
   * @param {Uint8Array} reconstructed - Reconstructed data
   */
  static assertDataIntegrity(original, reconstructed) {
    console.assert(reconstructed !== null, 'Reconstructed data should not be null');
    console.assert(original.length === reconstructed.length,
      `Length mismatch: original=${original.length}, reconstructed=${reconstructed.length}`);

    // Verify content byte by byte
    for (let i = 0; i < original.length; i++) {
      console.assert(original[i] === reconstructed[i],
        `Data mismatch at byte ${i}: original=${original[i]}, reconstructed=${reconstructed[i]}`);
    }

    // Verify hash integrity
    const originalHash = hashData(original);
    const reconstructedHash = hashData(reconstructed);
    console.assert(originalHash === reconstructedHash,
      'Hash mismatch between original and reconstructed data');
  }

  /**
   * Verify no data loss across commit history
   * @param {Array} commitHistory - Array of {data, hash} objects
   * @param {Object} store - Storage instance
   */
  static assertNoDataLoss(commitHistory, store) {
    for (let i = 0; i < commitHistory.length; i++) {
      const commit = commitHistory[i];
      const retrieved = store.getObject(commit.hash);

      console.assert(retrieved !== null, `Failed to retrieve commit ${i} data`);
      this.assertDataIntegrity(commit.data, retrieved);
    }
  }

  /**
   * Measure performance of an operation
   * @param {Function} operation - Function to measure
   * @returns {Object} Performance result with duration and result
   */
  static measurePerformance(operation) {
    const startTime = Date.now();
    const startMemory = process.memoryUsage();

    const result = operation();

    const endTime = Date.now();
    const endMemory = process.memoryUsage();

    return {
      result,
      duration: endTime - startTime,
      memoryDelta: {
        heapUsed: endMemory.heapUsed - startMemory.heapUsed,
        heapTotal: endMemory.heapTotal - startMemory.heapTotal,
        external: endMemory.external - startMemory.external
      }
    };
  }

  /**
   * Assert performance is within acceptable bounds
   * @param {Object} performanceResult - Result from measurePerformance()
   * @param {Object} bounds - Performance bounds {maxDuration, maxMemory}
   */
  static assertPerformanceBounds(performanceResult, bounds) {
    if (bounds.maxDuration) {
      console.assert(performanceResult.duration <= bounds.maxDuration,
        `Operation took ${performanceResult.duration}ms, expected <= ${bounds.maxDuration}ms`);
    }

    if (bounds.maxMemory) {
      console.assert(performanceResult.memoryDelta.heapUsed <= bounds.maxMemory,
        `Memory usage ${performanceResult.memoryDelta.heapUsed} bytes, expected <= ${bounds.maxMemory} bytes`);
    }
  }

  /**
   * Create test repository with delta support
   * @param {string} dbPath - Database path
   * @returns {Object} Repository instance
   */
  static createTestRepository(dbPath) {
    const { MiniRepo } = require('../../webdvcs-cli');
    const { initStore } = require('../../lib/core/storage');

    const store = initStore(dbPath);
    const repo = new MiniRepo(dbPath);

    return { repo, store };
  }

  /**
   * Clean up test databases and temporary files
   * @param {Array<string>} filePaths - Paths to clean up
   */
  static cleanup(filePaths) {
    const fs = require('fs');

    for (const filePath of filePaths) {
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (err) {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Generate unique test database name
   * @param {string} prefix - Prefix for the database name
   * @returns {string} Unique database path
   */
  static generateTestDbName(prefix = 'test-delta') {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 10000);
    return `${prefix}-${timestamp}-${random}.sqlite`;
  }

  /**
   * Assert delta chain integrity
   * @param {Object} store - Storage instance
   * @param {Array<string>} deltaHashes - Array of delta object hashes
   */
  static assertDeltaChainIntegrity(store, deltaHashes) {
    for (const hash of deltaHashes) {
      const deltaInfo = store.getDeltaInfo(hash);
      console.assert(deltaInfo !== null, `Delta info not found for hash: ${hash}`);

      if (deltaInfo.baseHash) {
        // Verify base object exists
        const hasBase = store.hasObject(deltaInfo.baseHash);
        console.assert(hasBase, `Base object missing for delta: ${hash}`);
      }

      // Verify delta can be reconstructed
      const reconstructed = store.getObjectWithDelta(hash);
      console.assert(reconstructed !== null, `Failed to reconstruct delta object: ${hash}`);
    }
  }

  /**
   * Log test section header
   * @param {string} section - Section name
   */
  static logSection(section) {
    console.log(`\n📋 ${section}`);
    console.log('='.repeat(section.length + 4));
  }

  /**
   * Log test subsection
   * @param {string} subsection - Subsection name
   */
  static logSubsection(subsection) {
    console.log(`\n🔍 ${subsection}`);
  }

  /**
   * Log performance metrics
   * @param {Object} metrics - Performance metrics
   */
  static logPerformanceMetrics(metrics) {
    console.log(`  ⏱️  Duration: ${metrics.duration}ms`);
    console.log(`  💾 Memory: ${(metrics.memoryDelta.heapUsed / 1024 / 1024).toFixed(2)}MB`);
  }

  /**
   * Create stress test data generator
   * @param {number} size - Size of data to generate
   * @param {string} pattern - Pattern type
   * @returns {Uint8Array} Large test data
   */
  static createStressTestData(size, pattern = 'mixed') {
    const data = new Uint8Array(size);

    if (pattern === 'mixed') {
      // Create mixed content with some patterns
      for (let i = 0; i < size; i++) {
        if (i % 1000 < 500) {
          // Repeated pattern section
          data[i] = 65 + (i % 26); // A-Z pattern
        } else {
          // Random section
          data[i] = Math.floor(Math.random() * 256);
        }
      }
    } else if (pattern === 'sequential') {
      for (let i = 0; i < size; i++) {
        data[i] = i % 256;
      }
    } else {
      for (let i = 0; i < size; i++) {
        data[i] = Math.floor(Math.random() * 256);
      }
    }

    return data;
  }
}

module.exports = { DeltaTestHelpers };