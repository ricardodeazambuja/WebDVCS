/**
 * WebDVCS Browser Core Library - Browser-specific VCS core abstraction
 * Mirrors webdvcs-core.js architecture for consistent API across platforms
 *
 * This abstraction layer ensures browser code uses the same clean API as CLI,
 * preventing direct imports from lib/core/* and maintaining architectural consistency.
 */

// Import core modules using browser-compatible approach
const { hashData, isBinary, arraysEqual, stringToUint8Array, uint8ArrayToString } = require('../core/utils');
const { ContentAddressedStore, initStore } = require('../core/storage');
const { storeBlob, getBlob } = require('../core/objects');
const { storeFile, getFile, hasFile } = require('../core/file-storage');
const { storeTree, getTree, createCommit, getCommit, getCommitHistory, commitExists, getTreeFiles } = require('../core/objects');
const { diffLines, formatDiff, diffFiles, getDiffSummary } = require('../core/diff');
const { ContentAddressedRepo } = require('../core/repo');

// Browser-specific storage initialization
const { BrowserDatabase, initBrowserSQL } = require('./browser-storage');

/**
 * Browser-optimized MiniRepo with async initialization
 * Uses composition to properly handle browser-specific async requirements
 */
class BrowserMiniRepo {
  constructor(dbPathOrData = 'webdvcs.sqlite', DatabaseConstructor = null) {
    this.dbPathOrData = dbPathOrData;
    this.DatabaseConstructor = DatabaseConstructor;
    this._initialized = false;
    this._coreRepo = null;
    this._initializing = false;

    // Browser-specific: collect logs for display
    this.logs = [];
  }

  /**
   * Initialize repository with browser database
   * Must be called before using any repository methods
   */
  async init() {
    if (this._initialized && this._coreRepo) {
      return this;
    }

    if (this._initializing) {
      throw new Error('Repository initialization already in progress');
    }

    this._initializing = true;

    try {
      // Initialize browser SQL if not provided
      if (!this.DatabaseConstructor) {
        this.DatabaseConstructor = await initBrowserSQL();
      }

      // Create core repository with browser database
      this._coreRepo = new ContentAddressedRepo(
        this.dbPathOrData,
        false,
        this.DatabaseConstructor
      );

      // Delegate all core properties
      this.store = this._coreRepo.store;
      this.stagingArea = this._coreRepo.stagingArea;
      this.removedFiles = this._coreRepo.removedFiles;
      this.debugMode = this._coreRepo.debugMode;

      // Initialize default branch if it doesn't exist
      this._initializeDefaultBranch();

      // Restore staging area from metadata (maintains CLI compatibility)
      this._restoreStagingArea();

      this._initialized = true;
      return this;
    } finally {
      this._initializing = false;
    }
  }

  /**
   * Initialize default branch metadata
   */
  _initializeDefaultBranch() {
    if (!this.store.getMeta('branches')) {
      this.store.setMeta('branches', JSON.stringify({ main: null }));
    }
    if (!this.store.getMeta('current_branch')) {
      this.store.setMeta('current_branch', 'main');
    }
  }

  /**
   * Restore staging area from persistent storage
   * Ensures compatibility with CLI-created repositories
   */
  _restoreStagingArea() {
    const savedStagingArea = this.store.getMeta('staging_area');
    if (!savedStagingArea) return;

    Object.entries(savedStagingArea).forEach(([path, fileInfo]) => {
      const hash = fileInfo.hash;
      if (!hash) {
        this.log(`Warning: Staged file ${path} missing hash reference`, 'warn');
        return;
      }

      try {
        // Verify file exists using pure delta system
        const data = getFile(hash, this.store);
        if (data) {
          this.stagingArea.set(path, {
            hash: hash,
            fileName: path,
            size: fileInfo.size || data.length,
            binary: fileInfo.binary || false
          });
          this.log(`Restored staged file: ${path} (${fileInfo.size || data.length} bytes)`);
        } else {
          this.log(`Warning: Staged file ${path} could not be restored - file not found`, 'warn');
        }
      } catch (error) {
        this.log(`Warning: Failed to restore staged file ${path}: ${error.message}`, 'warn');
      }
    });

    if (this.stagingArea.size === 0) {
      this.store.removeMeta('staging_area');
      this.log('Cleared orphaned staging area metadata');
    }
  }

  /**
   * Browser-friendly logging that collects messages
   */
  log(message, level = 'info') {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      message
    };

    this.logs.push(logEntry);

    // Also log to console in debug mode
    if (this.debugMode) {
      console.log(`[${level.toUpperCase()}] ${message}`);
    }
  }

  /**
   * Ensure repository is initialized before operations
   */
  _ensureInitialized() {
    if (!this._initialized) {
      throw new Error('Repository not initialized. Call init() first.');
    }
  }

  // Delegate all core methods to internal repo after initialization check

  add(filePath, content, options = {}) {
    this._ensureInitialized();
    const result = this._coreRepo.addFile(filePath, content, options.binary || false);
    this.log(`Added ${filePath} to staging area`);
    return result;
  }

  commit(message, author = null, email = null, options = {}) {
    this._ensureInitialized();
    const result = this._coreRepo.commit(message, author, email);
    this.log(`Created commit: ${result.commitHash.substring(0, 8)} - ${message}`);
    return {
      hash: result.commitHash,
      message,
      author,
      email,
      timestamp: result.timestamp,
      parent: result.parentHash
    };
  }

  getCommitHistory(maxCommits = 10) {
    this._ensureInitialized();
    // Get commit history from branch refs (same as core implementation)
    const currentBranch = this.getCurrentBranch();
    const ref = this.store.getRef(`refs/heads/${currentBranch}`);
    if (!ref || !ref.hash) return [];

    const history = [];
    let currentHash = ref.hash;
    let count = 0;

    while (currentHash && count < maxCommits) {
      const commit = getCommit(currentHash, this.store);
      if (!commit) break;

      history.push({
        hash: currentHash,
        message: commit.message,
        author: commit.author,
        email: commit.email,
        timestamp: commit.timestamp,
        parent: commit.parent
      });

      currentHash = commit.parent;
      count++;
    }

    return history;
  }

  getCommit(hash) {
    this._ensureInitialized();
    return getCommit(hash, this.store);
  }

  getTree(hash) {
    this._ensureInitialized();
    return getTree(hash, this.store);
  }

  status() {
    this._ensureInitialized();
    // Return staging area status
    const staged = Array.from(this.stagingArea.keys());
    const removed = Array.from(this.removedFiles);

    return {
      staged,
      removed,
      modified: [],  // Not tracked in browser version
      untracked: []  // Not tracked in browser version
    };
  }

  reset(mode = 'mixed') {
    this._ensureInitialized();
    // Clear staging area
    this.stagingArea.clear();
    this.removedFiles.clear();
    this.store.removeMeta('staging_area');
    this.store.removeMeta('removed_files');
    this.log(`Reset staging area (${mode} mode)`);
    return { success: true };
  }

  getCurrentBranch() {
    this._ensureInitialized();
    // Get current branch from metadata
    return this.store.getMeta('current_branch') || 'main';
  }

  checkout(branchName) {
    this._ensureInitialized();
    // Check if branch exists in either metadata or branch references
    const branchesJson = this.store.getMeta('branches') || '{"main":null}';
    const branches = JSON.parse(branchesJson);
    const branchRef = this.store.getRef(`refs/heads/${branchName}`);

    if (!branches[branchName] && !branchRef) {
      throw new Error(`Branch ${branchName} does not exist`);
    }

    this.store.setMeta('current_branch', branchName);

    // Update HEAD from branch reference if available, otherwise from metadata
    const head = branchRef ? branchRef.hash : branches[branchName];
    this.store.setMeta('HEAD', head);

    this.log(`Switched to branch: ${branchName}`);
    return { success: true, branch: branchName };
  }

  createBranch(branchName, startPoint = null) {
    this._ensureInitialized();
    // Create new branch
    const branchesJson = this.store.getMeta('branches') || '{"main":null}';
    const branches = JSON.parse(branchesJson);

    if (branches[branchName]) {
      throw new Error(`Branch ${branchName} already exists`);
    }

    // Get current commit hash from current branch reference
    let head = startPoint;
    if (!head) {
      const currentBranch = this.getCurrentBranch();
      const currentRef = this.store.getRef(`refs/heads/${currentBranch}`);
      head = currentRef ? currentRef.hash : null;
    }

    branches[branchName] = head;
    this.store.setMeta('branches', JSON.stringify(branches));

    // Also create the branch reference for consistency with core
    if (head) {
      this.store.setRef(`refs/heads/${branchName}`, head, 'branch');
    }

    this.log(`Created branch: ${branchName}`);
    return { success: true, branch: branchName };
  }

  getBranches() {
    this._ensureInitialized();
    // Get branches from both metadata store and branch references
    const branchesJson = this.store.getMeta('branches') || '{"main":null}';
    const branches = JSON.parse(branchesJson);
    const metaBranches = Object.keys(branches);

    // Also check for branches in refs/heads/
    const allRefs = this.store.listRefs();
    const refBranches = allRefs
      .filter(ref => ref.name.startsWith('refs/heads/'))
      .map(ref => ref.name.replace('refs/heads/', ''));

    // Combine and deduplicate
    const allBranches = [...new Set([...metaBranches, ...refBranches])];
    return allBranches;
  }

  deleteBranch(branchName, runGC = true) {
    this._ensureInitialized();

    // Check if trying to delete current branch
    const currentBranch = this.getCurrentBranch();
    if (branchName === currentBranch) {
      throw new Error('Cannot delete current branch');
    }

    // Check if branch exists in metadata
    const branchesJson = this.store.getMeta('branches') || '{"main":null}';
    const branches = JSON.parse(branchesJson);

    // Remove from metadata if it exists
    let branchExisted = false;
    if (branches[branchName] !== undefined) {
      delete branches[branchName];
      this.store.setMeta('branches', JSON.stringify(branches));
      branchExisted = true;
    }

    // Remove branch reference
    const deleted = this.store.removeRef(`refs/heads/${branchName}`);
    if (deleted) {
      branchExisted = true;
    }

    if (!branchExisted) {
      throw new Error(`Branch '${branchName}' does not exist`);
    }

    // Basic garbage collection (simplified for browser)
    let gcStats = null;
    if (runGC) {
      // Browser version doesn't implement full GC, but we can provide placeholder stats
      gcStats = {
        objectsRemoved: 0,
        spaceSaved: 0,
        message: 'Branch deleted successfully'
      };
    }

    this.log(`Deleted branch: ${branchName}`);
    return {
      deleted: true,
      branchName,
      gcStats
    };
  }

  merge(branchName, options = {}) {
    this._ensureInitialized();

    try {
      // Handle preview mode - check for conflicts without making changes
      if (options.preview) {
        const result = this._previewMerge(branchName);
        return {
          success: result.type !== 'conflict',
          type: result.type,
          commitHash: result.commitHash,
          conflicts: result.conflicts || [],
          message: this._getMergeMessage(result, branchName)
        };
      }

      // Delegate to the core repository merge implementation
      const result = this._coreRepo.merge(branchName);

      // Log the merge result
      if (result.type === 'fast-forward') {
        this.log(`Fast-forward merge of branch: ${branchName}`);
      } else if (result.type === 'three-way') {
        this.log(`Three-way merge of branch: ${branchName} (commit: ${result.commitHash?.substring(0, 8)})`);
      } else if (result.type === 'up-to-date') {
        this.log(`Already up-to-date with branch: ${branchName}`);
      } else if (result.type === 'conflict') {
        this.log(`Merge conflicts detected with branch: ${branchName}`, 'warn');
        // Debug log conflict details
        if (result.conflicts && result.conflicts.length > 0) {
          result.conflicts.forEach(conflict => {
            this.log(`🔍 Conflict: ${conflict.file} (${conflict.type})`, 'debug');
          });
        }
      }

      return {
        success: result.type !== 'conflict',
        type: result.type,
        commitHash: result.commitHash,
        conflicts: result.conflicts || [],
        message: this._getMergeMessage(result, branchName)
      };

    } catch (error) {
      this.log(`Failed to merge branch ${branchName}: ${error.message}`, 'error');

      // Check if this is a merge conflict error with conflicts array
      if (error.conflicts && error.conflicts.length > 0) {
        this.log(`Merge conflicts detected with branch: ${branchName}`, 'warn');
        error.conflicts.forEach(conflict => {
          this.log(`🔍 Conflict: ${conflict.file} (${conflict.type})`, 'debug');
        });

        return {
          success: false,
          type: 'conflict',
          message: error.message,
          conflicts: error.conflicts
        };
      }

      return {
        success: false,
        type: 'error',
        message: error.message,
        conflicts: []
      };
    }
  }

  _getMergeMessage(result, branchName) {
    switch (result.type) {
      case 'fast-forward':
        return `Fast-forward merge of '${branchName}' completed successfully`;
      case 'three-way':
        return `Three-way merge of '${branchName}' completed successfully`;
      case 'up-to-date':
        return `Already up-to-date with '${branchName}'`;
      case 'conflict':
        const conflictCount = result.conflicts?.length || 0;
        return `Merge conflict${conflictCount !== 1 ? 's' : ''} detected (${conflictCount} file${conflictCount !== 1 ? 's' : ''})`;
      default:
        return `Merge of '${branchName}' completed`;
    }
  }

  _previewMerge(branchName) {
    // Preview merge by checking for conflicts without modifying repository state
    const { findMergeBase, getCommit, getTree } = require('../core/objects');

    // Get current and target branch heads
    const currentBranch = this.getCurrentBranch();
    const currentHead = this.getCurrentHead();
    const targetRef = this.store.getRef(`refs/heads/${branchName}`);

    if (!targetRef || !targetRef.hash) {
      throw new Error(`Branch '${branchName}' not found`);
    }
    const targetHead = targetRef.hash;

    // Handle same commit case
    if (currentHead === targetHead) {
      return { type: 'up-to-date' };
    }

    // Handle case where current branch has no commits (empty branch)
    if (!currentHead) {
      return { type: 'fast-forward' };
    }

    // Find merge base
    const mergeBase = findMergeBase(currentHead, targetHead, this.store);

    // Check for fast-forward merge (current is ancestor of target)
    if (mergeBase === currentHead) {
      return { type: 'fast-forward' };
    }

    // Check if target is ancestor of current (already up-to-date)
    if (mergeBase === targetHead) {
      return { type: 'up-to-date' };
    }

    // Three-way merge needed - check for conflicts
    return this._checkMergeConflicts(currentHead, targetHead, mergeBase);
  }

  _checkMergeConflicts(currentHead, targetHead, mergeBase) {
    const { getCommit, getTree } = require('../core/objects');

    const currentCommit = getCommit(currentHead, this.store);
    const targetCommit = getCommit(targetHead, this.store);
    const baseCommit = mergeBase ? getCommit(mergeBase, this.store) : null;

    // Get trees for all three commits
    const currentTree = getTree(currentCommit.tree, this.store);
    const targetTree = getTree(targetCommit.tree, this.store);
    const baseTree = baseCommit ? getTree(baseCommit.tree, this.store) : [];

    // Build maps for easier lookup
    const currentFiles = new Map(currentTree.map(entry => [entry.name, entry]));
    const targetFiles = new Map(targetTree.map(entry => [entry.name, entry]));
    const baseFiles = new Map(baseTree.map(entry => [entry.name, entry]));

    // Collect all file names from all trees
    const allFileNames = new Set([
      ...currentFiles.keys(),
      ...targetFiles.keys(),
      ...baseFiles.keys()
    ]);

    const conflicts = [];

    for (const fileName of allFileNames) {
      const baseEntry = baseFiles.get(fileName);
      const currentEntry = currentFiles.get(fileName);
      const targetEntry = targetFiles.get(fileName);

      // Apply three-way merge logic to detect conflicts
      if (!baseEntry && currentEntry && targetEntry) {
        // File added in both - check if identical
        if (currentEntry.hash !== targetEntry.hash) {
          conflicts.push({
            file: fileName,
            type: 'both-added',
            message: `File added in both branches with different content`
          });
        }
      } else if (baseEntry && !currentEntry && targetEntry) {
        // File deleted in current, modified in target
        if (baseEntry.hash !== targetEntry.hash) {
          conflicts.push({
            file: fileName,
            type: 'deleted-modified',
            message: `File deleted in current branch but modified in target`
          });
        }
      } else if (baseEntry && currentEntry && !targetEntry) {
        // File modified in current, deleted in target
        if (baseEntry.hash !== currentEntry.hash) {
          conflicts.push({
            file: fileName,
            type: 'modified-deleted',
            message: `File modified in current branch but deleted in target`
          });
        }
      } else if (baseEntry && currentEntry && targetEntry) {
        // File exists in all three - check for conflicts
        if (currentEntry.hash !== targetEntry.hash &&
            baseEntry.hash !== currentEntry.hash &&
            baseEntry.hash !== targetEntry.hash) {
          conflicts.push({
            file: fileName,
            type: 'both-modified',
            message: `File modified in both branches`
          });
        }
      }
    }

    // Return conflict result or success
    if (conflicts.length > 0) {
      return {
        type: 'conflict',
        conflicts: conflicts
      };
    } else {
      return {
        type: 'three-way',
        commitHash: null // No commit created in preview mode
      };
    }
  }

  diff(fromCommit, toCommit = null) {
    this._ensureInitialized();

    // Helper function to get files from a commit
    const getCommitFiles = (commitHash) => {
      const commit = getCommit(commitHash, this.store);
      if (!commit) return [];

      const tree = getTree(commit.tree, this.store);
      if (!tree) return [];

      return tree.map(entry => ({
        name: entry.name,
        path: entry.name, // UI compatibility
        hash: entry.hash,
        size: entry.size || 0,
        binary: entry.binary || false
      }));
    };

    // Get files from both commits
    const fromFiles = getCommitFiles(fromCommit);
    const toFiles = toCommit ? getCommitFiles(toCommit) : [];

    // Create maps for quick lookup
    const fromFileMap = new Map();
    fromFiles.forEach(file => {
      fromFileMap.set(file.name, file);
    });

    const toFileMap = new Map();
    toFiles.forEach(file => {
      toFileMap.set(file.name, file);
    });

    const changes = [];

    // Check for added and modified files
    for (const [path, file] of toFileMap) {
      if (!fromFileMap.has(path)) {
        // Added file - estimate additions based on file size
        const estimatedLines = Math.max(1, Math.floor(file.size / 50)); // Rough estimate
        changes.push({
          file,
          type: 'added',
          additions: estimatedLines,
          deletions: 0
        });
      } else {
        const fromFile = fromFileMap.get(path);
        // Compare by hash for accurate modification detection
        if (fromFile.hash !== file.hash) {
          // Modified file - estimate changes based on size difference
          const sizeDiff = Math.abs(file.size - fromFile.size);
          const estimatedChanges = Math.max(1, Math.floor(sizeDiff / 25));
          changes.push({
            file,
            type: 'modified',
            additions: file.size > fromFile.size ? estimatedChanges : Math.floor(estimatedChanges / 2),
            deletions: file.size < fromFile.size ? estimatedChanges : Math.floor(estimatedChanges / 2)
          });
        }
      }
    }

    // Check for deleted files
    for (const [path, file] of fromFileMap) {
      if (!toFileMap.has(path)) {
        // Deleted file - estimate deletions based on file size
        const estimatedLines = Math.max(1, Math.floor(file.size / 50));
        changes.push({
          file,
          type: 'deleted',
          additions: 0,
          deletions: estimatedLines
        });
      }
    }

    return changes;
  }

  exportDatabase() {
    this._ensureInitialized();
    // Export the SQLite database as binary data
    if (this.store.db && this.store.db.export) {
      return this.store.db.export();
    }
    throw new Error('Database export not available');
  }

  getStorageAnalytics() {
    this._ensureInitialized();

    try {
      // Get total objects and sizes (restore original better-sqlite3 API usage)
      const totalStats = this.store.db.prepare(`
        SELECT
          COUNT(*) as totalObjects,
          SUM(size) as totalUncompressed,
          SUM(LENGTH(data)) as totalCompressed,
          type
        FROM objects
        GROUP BY type
      `).all();

      // Calculate overall totals
      let totalObjects = 0;
      let totalUncompressed = 0;
      let totalCompressed = 0;
      const objectBreakdown = { blob: 0, tree: 0, commit: 0 };

      for (const stat of totalStats) {
        totalObjects += stat.totalObjects;
        totalUncompressed += stat.totalUncompressed || 0;
        totalCompressed += stat.totalCompressed || 0;
        objectBreakdown[stat.type] = stat.totalObjects;
      }

      // Calculate compression ratio as percentage reduction
      const compressionRatio = totalUncompressed > 0
        ? ((totalUncompressed - totalCompressed) / totalUncompressed) * 100
        : 0;

      // Calculate file metrics from blob objects only
      const blobCount = objectBreakdown.blob || 0;
      const blobStats = totalStats.find(stat => stat.type === 'blob');
      const avgFileSize = blobCount > 0 && blobStats ? Math.round(blobStats.totalUncompressed / blobCount) : 0;

      // Find largest object across all types
      const largestObjectSize = this.store.db.prepare(`
        SELECT MAX(size) as maxSize FROM objects
      `).get()?.maxSize || 0;

      return {
        totalObjects,
        totalSize: totalCompressed, // Size on disk (compressed)
        uncompressedSize: totalUncompressed,
        compressionRatio,
        deduplicationSavings: compressionRatio, // Use compression ratio as deduplication savings
        objectBreakdown: {
          commits: objectBreakdown.commit || 0,
          trees: objectBreakdown.tree || 0,
          blobs: objectBreakdown.blob || 0
        },
        averageFileSize: avgFileSize,
        largestObject: largestObjectSize
      };
    } catch (error) {
      this.log(`Error getting storage analytics: ${error.message}`, 'error');
      return {
        totalObjects: 0,
        totalSize: 0,
        uncompressedSize: 0,
        compressionRatio: 0,
        deduplicationSavings: 0,
        objectBreakdown: { commits: 0, trees: 0, blobs: 0 }
      };
    }
  }

  close() {
    this._ensureInitialized();
    // Close database connection
    if (this.store.db && this.store.db.close) {
      this.store.db.close();
    }
    this._initialized = false;
    this._coreRepo = null;
  }
}

// Export browser core functionality with consistent API
module.exports = {
  // Core classes
  MiniRepo: BrowserMiniRepo,
  BrowserMiniRepo,

  // Storage functions (pure, same as CLI)
  initStore,
  storeBlob,
  getBlob,

  // Utility functions (pure, same as CLI)
  hashData,
  isBinary,
  arraysEqual,
  stringToUint8Array,
  uint8ArrayToString,

  // File operations (pure delta, same as CLI)
  storeFile,
  getFile,
  hasFile,

  // Tree and commit operations (pure, same as CLI)
  storeTree,
  getTree,
  createCommit,
  getCommit,
  getCommitHistory,
  commitExists,
  getTreeFiles,

  // Diff functionality (pure, same as CLI)
  diffLines,
  formatDiff,
  diffFiles,
  getDiffSummary,

  // Browser-specific exports
  BrowserDatabase,
  initBrowserSQL,

  // Environment info
  isNode: false,
  isBrowser: true
};

// Make available globally for browser environments
if (typeof window !== 'undefined') {
  window.WebDVCSBrowserCore = module.exports;
}