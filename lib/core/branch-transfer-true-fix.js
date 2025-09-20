/**
 * TRUE FIX: Branch Transfer - Only Export Differential Objects
 * Exports ONLY objects that don't exist in other branches
 */

const { ContentAddressedStore } = require('./storage');
const { getCommitHistory, getOptimizedCommitHistory, getCommit, getTree, getBlob } = require('./objects');

class BranchTransferTrueFix {
  constructor(store) {
    this.store = store;
  }

  /**
   * Export branch with TRUE differential - only new objects
   * @param {string} branchName - Branch name to export
   * @returns {Uint8Array} - SQLite database with ONLY new objects
   */
  exportBranch(branchName) {
    // Get branch reference
    const branchRef = this.store.getRef(`refs/heads/${branchName}`);
    if (!branchRef) {
      throw new Error(`Branch '${branchName}' not found`);
    }

    // Get all other branch heads
    const allRefs = this.store.listRefs();
    const otherBranches = allRefs
      .filter(ref => ref.name.startsWith('refs/heads/') && ref.name !== `refs/heads/${branchName}`)
      .map(ref => ref.hash);

    console.log(`TRUE differential export for branch '${branchName}'...`);

    // Find objects that exist in other branches (to exclude)
    const existingObjects = new Set();
    for (const otherBranchHash of otherBranches) {
      this.collectAllReachableObjects(otherBranchHash, existingObjects);
    }

    // Get optimized commit history (only commits specific to this branch)
    const branchCommits = getOptimizedCommitHistory(branchRef.hash, otherBranches, this.store);

    // Collect ONLY objects that are NEW to this branch
    const newObjects = new Set();

    for (const commit of branchCommits) {
      // Always include the commit object itself
      if (!existingObjects.has(commit.hash)) {
        newObjects.add(commit.hash);
      }

      // Include tree and blob objects that are new
      this.collectNewObjectsFromCommit(commit.hash, existingObjects, newObjects);
    }

    console.log(`Found ${existingObjects.size} existing objects in other branches`);
    console.log(`Exporting ${newObjects.size} NEW objects only`);

    if (newObjects.size === 0) {
      throw new Error('No new objects to export - branch is identical to existing branches');
    }

    // Create export database
    const exportStore = this._createExportDatabase();

    try {
      // Export ONLY the new objects
      let exportedCount = 0;
      for (const hash of newObjects) {
        const obj = this.store.getObject(hash);
        if (obj) {
          exportStore.storeObject(obj.data, obj.type, obj.compression);
          exportedCount++;
        }
      }

      // Store branch reference
      exportStore.setRef(`refs/heads/${branchName}`, branchRef.hash, 'branch');

      // Store metadata about what was excluded
      exportStore.setMeta('export_type', 'differential');
      exportStore.setMeta('export_metadata', JSON.stringify({
        source_branch: branchName,
        exported_objects: exportedCount,
        excluded_objects: existingObjects.size,
        export_timestamp: Date.now(),
        warning: 'This is a differential export. Target repository must have base objects.'
      }));

      // Serialize export database
      const exportData = exportStore.db.serialize ? exportStore.db.serialize() : exportStore.db.export();
      exportStore.close();

      console.log(`✅ TRUE differential export: ${exportedCount} objects, ${(exportData.length / 1024).toFixed(1)}KB`);
      return exportData;

    } catch (error) {
      exportStore.close();
      throw error;
    }
  }

  /**
   * Collect only NEW objects from a commit (not existing in other branches)
   * @param {string} commitHash - Commit to analyze
   * @param {Set} existingObjects - Objects that exist in other branches
   * @param {Set} newObjects - Set to add new objects to
   */
  collectNewObjectsFromCommit(commitHash, existingObjects, newObjects) {
    const commit = getCommit(commitHash, this.store);
    if (!commit || !commit.tree) return;

    // Check tree object
    if (!existingObjects.has(commit.tree)) {
      newObjects.add(commit.tree);

      // Check tree contents
      const tree = getTree(commit.tree, this.store);
      if (tree) {
        for (const entry of tree) {
          if (entry.hash && !existingObjects.has(entry.hash)) {
            newObjects.add(entry.hash);

            // Recursively check subdirectories
            if (entry.type === 'tree') {
              this.collectNewObjectsFromTree(entry.hash, existingObjects, newObjects);
            }
          }
        }
      }
    }
  }

  /**
   * Recursively collect new objects from a tree
   * @param {string} treeHash - Tree to analyze
   * @param {Set} existingObjects - Objects that exist in other branches
   * @param {Set} newObjects - Set to add new objects to
   */
  collectNewObjectsFromTree(treeHash, existingObjects, newObjects) {
    if (existingObjects.has(treeHash) || newObjects.has(treeHash)) {
      return; // Already processed
    }

    const tree = getTree(treeHash, this.store);
    if (!tree) return;

    for (const entry of tree) {
      if (entry.hash && !existingObjects.has(entry.hash)) {
        newObjects.add(entry.hash);

        if (entry.type === 'tree') {
          this.collectNewObjectsFromTree(entry.hash, existingObjects, newObjects);
        }
      }
    }
  }

  /**
   * Import differential branch
   * @param {Uint8Array} exportData - Export data
   * @returns {Object} - Import statistics
   */
  importBranch(exportData) {
    const tempStore = this._createTempDatabase(exportData);
    const stats = {
      branch: null,
      objects_imported: 0,
      objects_skipped: 0,
      differential: false
    };

    try {
      // Check if this is a differential export
      const exportType = tempStore.getMeta('export_type');
      if (exportType === 'differential') {
        stats.differential = true;
        const metadataRaw = tempStore.getMeta('export_metadata');
        const metadata = metadataRaw ? JSON.parse(metadataRaw) : null;
        if (metadata) {
          console.log(`Importing differential branch '${metadata.source_branch}'`);
          console.log(`⚠️  ${metadata.warning}`);
        }
      }

      // Import all objects
      const allObjects = tempStore.db.prepare('SELECT * FROM objects').all();
      for (const row of allObjects) {
        if (this.store.hasObject(row.hash)) {
          stats.objects_skipped++;
          continue;
        }

        this.store.db.prepare('INSERT OR IGNORE INTO objects (hash, type, size, data, compression, created_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(row.hash, row.type, row.size, row.data, row.compression, row.created_at);

        stats.objects_imported++;
      }

      // Import branch references
      const refs = tempStore.db.prepare('SELECT * FROM refs').all();
      for (const ref of refs) {
        this.store.setRef(ref.name, ref.hash, ref.type);
        stats.branch = ref.name.replace('refs/heads/', '');
      }

      console.log(`✅ Import complete: ${stats.objects_imported} objects imported, ${stats.objects_skipped} skipped`);

      tempStore.close();
      return stats;

    } catch (error) {
      tempStore.close();
      throw error;
    }
  }

  /**
   * Get export statistics
   * @param {string} branchName - Branch name
   * @returns {Object} - Export statistics
   */
  getExportStats(branchName) {
    const branchRef = this.store.getRef(`refs/heads/${branchName}`);
    if (!branchRef) {
      throw new Error(`Branch '${branchName}' not found`);
    }

    // Get other branches
    const allRefs = this.store.listRefs();
    const otherBranches = allRefs
      .filter(ref => ref.name.startsWith('refs/heads/') && ref.name !== `refs/heads/${branchName}`)
      .map(ref => ref.hash);

    // Find existing objects
    const existingObjects = new Set();
    for (const otherBranchHash of otherBranches) {
      this.collectAllReachableObjects(otherBranchHash, existingObjects);
    }

    // Get branch commits
    const branchCommits = getOptimizedCommitHistory(branchRef.hash, otherBranches, this.store);

    // Count new objects
    const newObjects = new Set();
    for (const commit of branchCommits) {
      if (!existingObjects.has(commit.hash)) {
        newObjects.add(commit.hash);
      }
      this.collectNewObjectsFromCommit(commit.hash, existingObjects, newObjects);
    }

    // Calculate sizes
    let newObjectsSize = 0;
    for (const hash of newObjects) {
      const obj = this.store.getObject(hash);
      if (obj) {
        newObjectsSize += obj.size;
      }
    }

    const totalObjects = this.store.db.prepare('SELECT COUNT(*) as count FROM objects').get().count;
    const totalSize = this.store.db.prepare('SELECT SUM(size) as size FROM objects').get().size;

    return {
      branch: branchName,
      total_objects_in_repo: totalObjects,
      existing_objects: existingObjects.size,
      new_objects: newObjects.size,
      new_objects_percentage: Math.round((newObjects.size / totalObjects) * 100),
      new_objects_size: newObjectsSize,
      total_repo_size: totalSize,
      size_reduction_percentage: Math.round((1 - newObjectsSize / totalSize) * 100),
      export_type: 'differential_only'
    };
  }

  /**
   * Collect ALL reachable objects
   * @param {string} commitHash - Starting commit hash
   * @param {Set} reachable - Set to add objects to
   */
  collectAllReachableObjects(commitHash, reachable) {
    const queue = [commitHash];

    while (queue.length > 0) {
      const hash = queue.shift();
      if (!hash || reachable.has(hash)) continue;

      reachable.add(hash);

      const obj = this.store.getObject(hash);
      if (!obj) continue;

      if (obj.type === 'commit') {
        const commit = getCommit(hash, this.store);
        if (commit.tree) queue.push(commit.tree);
        if (commit.parent) queue.push(commit.parent);
      } else if (obj.type === 'tree') {
        const tree = getTree(hash, this.store);
        for (const entry of tree) {
          if (entry.hash) queue.push(entry.hash);
        }
      }
    }
  }

  _createExportDatabase() {
    return new ContentAddressedStore(':memory:', this.store.db.constructor);
  }

  _createTempDatabase(exportData) {
    try {
      return new ContentAddressedStore(exportData, this.store.db.constructor);
    } catch (error) {
      throw new Error(`Invalid SQLite database format: ${error.message}`);
    }
  }

  getExportFilename(branchName) {
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    return `${branchName}-${timestamp}.webdvcs-branch`;
  }

  serializeExport(exportData) {
    return exportData;
  }

  parseImport(binaryData) {
    if (!binaryData || !(binaryData instanceof Uint8Array)) {
      throw new Error('Invalid export file format: expected SQLite database');
    }
    return binaryData;
  }
}

module.exports = BranchTransferTrueFix;