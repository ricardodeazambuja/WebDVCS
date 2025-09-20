/**
 * Optimized Branch Transfer for Content-Addressed Storage
 * Supports partial exports without foreign key constraints
 */

const { ContentAddressedStore } = require('./storage');
const { getCommitHistory, getOptimizedCommitHistory, collectReachableObjects } = require('./objects');

class BranchTransfer {
  constructor(store) {
    this.store = store;
  }

  /**
   * Export a branch with optimization (only branch-specific objects)
   * @param {string} branchName - Branch name to export
   * @returns {Uint8Array} - SQLite database containing optimized branch data
   */
  exportBranch(branchName) {
    // Get branch reference
    const branchRef = this.store.getRef(`refs/heads/${branchName}`);
    if (!branchRef) {
      throw new Error(`Branch '${branchName}' not found`);
    }

    // Get all other branch heads for optimization
    const allRefs = this.store.listRefs();
    const otherBranches = allRefs
      .filter(ref => ref.name.startsWith('refs/heads/') && ref.name !== `refs/heads/${branchName}`)
      .map(ref => ref.hash);

    // Get optimized commit history (from merge base to branch head)
    const commits = getOptimizedCommitHistory(branchRef.hash, otherBranches, this.store);

    // Collect all objects reachable from these commits
    const objectsToExport = new Set();
    for (const commit of commits) {
      const reachable = collectReachableObjects(commit.hash, this.store);
      for (const hash of reachable) {
        objectsToExport.add(hash);
      }
    }

    console.log(`Exporting ${commits.length} commits with ${objectsToExport.size} objects`);

    // Create export database with same schema
    const exportStore = this._createExportDatabase();

    try {
      // Copy all required objects
      for (const hash of objectsToExport) {
        const obj = this.store.getObject(hash);
        if (obj) {
          exportStore.storeObject(obj.data, obj.type, obj.compression);
        }
      }

      // Copy the branch reference
      exportStore.setRef(`refs/heads/${branchName}`, branchRef.hash, 'branch');

      // Serialize export database
      const exportData = exportStore.db.serialize ? exportStore.db.serialize() : exportStore.db.export();
      exportStore.close();

      return exportData;

    } catch (error) {
      exportStore.close();
      throw error;
    }
  }

  /**
   * Import a branch from export data
   * @param {Uint8Array} exportData - SQLite database from exportBranch()
   * @returns {Object} - Import statistics
   */
  importBranch(exportData) {
    const tempStore = this._createTempDatabase(exportData);
    const stats = {
      branch: null,
      objects_imported: 0,
      skipped_existing: 0
    };

    try {
      // Import all objects
      const allObjects = tempStore.db.prepare('SELECT * FROM objects').all();
      for (const row of allObjects) {
        if (this.store.hasObject(row.hash)) {
          stats.skipped_existing++;
          continue;
        }

        // Import object with original compression
        let content;
        if (row.compression === 'zlib') {
          content = row.data; // Already compressed
        } else {
          content = row.data;
        }

        // Store object directly (bypassing compression since it's already done)
        this.store.db.prepare('INSERT OR IGNORE INTO objects (hash, type, size, data, compression, created_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(row.hash, row.type, row.size, content, row.compression, row.created_at);

        stats.objects_imported++;
      }

      // Import branch references
      const refs = tempStore.db.prepare('SELECT * FROM refs').all();
      for (const ref of refs) {
        this.store.setRef(ref.name, ref.hash, ref.type);
        stats.branch = ref.name.replace('refs/heads/', '');
      }

      tempStore.close();
      return stats;

    } catch (error) {
      tempStore.close();
      throw error;
    }
  }

  /**
   * Get export filename for a branch
   * @param {string} branchName - Branch name
   * @returns {string} - Suggested filename
   */
  getExportFilename(branchName) {
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    return `${branchName}-${timestamp}.webdvcs-branch`;
  }

  /**
   * Serialize export data
   * @param {Uint8Array} exportData - SQLite database
   * @returns {Uint8Array} - Binary data
   */
  serializeExport(exportData) {
    return exportData;
  }

  /**
   * Parse import data
   * @param {Uint8Array} binaryData - SQLite database
   * @returns {Uint8Array} - Binary data
   */
  parseImport(binaryData) {
    if (!binaryData || !(binaryData instanceof Uint8Array)) {
      throw new Error('Invalid export file format: expected SQLite database');
    }
    return binaryData;
  }

  /**
   * Create export database with content-addressed schema
   * @returns {ContentAddressedStore} - Export database instance
   */
  _createExportDatabase() {
    return new ContentAddressedStore(':memory:', this.store.db.constructor);
  }

  /**
   * Create temporary database from import data
   * @param {Uint8Array} exportData - SQLite database
   * @returns {ContentAddressedStore} - Temporary database instance
   */
  _createTempDatabase(exportData) {
    try {
      return new ContentAddressedStore(exportData, this.store.db.constructor);
    } catch (error) {
      throw new Error(`Invalid SQLite database format: ${error.message}`);
    }
  }

  /**
   * Get export statistics for analysis
   * @param {string} branchName - Branch name
   * @returns {Object} - Export statistics
   */
  getExportStats(branchName) {
    const branchRef = this.store.getRef(`refs/heads/${branchName}`);
    if (!branchRef) {
      throw new Error(`Branch '${branchName}' not found`);
    }

    // Get all other branch heads
    const allRefs = this.store.listRefs();
    const otherBranches = allRefs
      .filter(ref => ref.name.startsWith('refs/heads/') && ref.name !== `refs/heads/${branchName}`)
      .map(ref => ref.hash);

    // Compare full vs optimized
    const fullCommits = getCommitHistory(branchRef.hash, 1000, this.store);
    const optimizedCommits = getOptimizedCommitHistory(branchRef.hash, otherBranches, this.store);

    // Count objects
    const fullObjects = new Set();
    for (const commit of fullCommits) {
      const reachable = collectReachableObjects(commit.hash, this.store);
      for (const hash of reachable) {
        fullObjects.add(hash);
      }
    }

    const optimizedObjects = new Set();
    for (const commit of optimizedCommits) {
      const reachable = collectReachableObjects(commit.hash, this.store);
      for (const hash of reachable) {
        optimizedObjects.add(hash);
      }
    }

    return {
      branch: branchName,
      full_commits: fullCommits.length,
      optimized_commits: optimizedCommits.length,
      commit_reduction_percent: Math.round((1 - optimizedCommits.length / fullCommits.length) * 100),
      full_objects: fullObjects.size,
      optimized_objects: optimizedObjects.size,
      object_reduction_percent: Math.round((1 - optimizedObjects.size / fullObjects.size) * 100)
    };
  }
}

module.exports = BranchTransfer;