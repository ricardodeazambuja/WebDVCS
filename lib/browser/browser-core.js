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
      this.store.deleteMeta('staging_area');
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
    this.store.deleteMeta('staging_area');
    this.store.deleteMeta('removed_files');
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

  merge(branchName) {
    this._ensureInitialized();
    // Branch operations not fully implemented in core yet
    this.log(`Merge operation for branch: ${branchName} (not implemented)`);
    return { success: false, message: 'Merge not yet implemented' };
  }

  diff(fromCommit, toCommit = null) {
    this._ensureInitialized();
    // Use diffFiles from core
    const fromCommitData = getCommit(fromCommit, this.store);
    const toCommitData = toCommit ? getCommit(toCommit, this.store) : null;

    if (!fromCommitData) {
      throw new Error(`Commit ${fromCommit} not found`);
    }

    const fromTree = getTree(fromCommitData.tree, this.store);
    const toTree = toCommitData ? getTree(toCommitData.tree, this.store) : {};

    return diffFiles(fromTree, toTree, this.store);
  }

  exportDatabase() {
    this._ensureInitialized();
    // Export the SQLite database as binary data
    if (this.store.db && this.store.db.export) {
      return this.store.db.export();
    }
    throw new Error('Database export not available');
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