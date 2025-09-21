/**
 * Browser Entry Point - Uses Browser Core Abstraction for CLI Compatibility
 *
 * This entry point now uses webdvcs-browser-core.js abstraction layer
 * to ensure 100% API compatibility with CLI version, fixing the architectural
 * inconsistency where browser bypassed the core abstraction.
 */

// Import from browser core abstraction (mirrors CLI's use of webdvcs-core.js)
const browserCore = require('./browser-core');
const {
  BrowserMiniRepo,
  getFile,
  getCommit,
  getTree,
  initBrowserSQL
} = browserCore;

/**
 * Browser Repository - Clean wrapper using core abstraction
 * Provides browser-specific features while maintaining API consistency
 */
class BrowserRepo extends BrowserMiniRepo {
  constructor(dbPathOrData = 'webdvcs.sqlite', DatabaseConstructor = null) {
    super(dbPathOrData, DatabaseConstructor);

    // Track initialization state for worker communication
    this.isInitialized = false;
  }

  /**
   * Initialize repository with progress tracking
   */
  async init(progressCallback = null) {
    if (progressCallback) {
      progressCallback('Initializing repository...', 0);
    }

    // Initialize using parent class method
    await super.init();

    this.isInitialized = true;

    if (progressCallback) {
      progressCallback('Repository initialized', 100);
    }

    return this;
  }

  /**
   * Add multiple files in batch with progress tracking
   */
  async addFilesBatch(files, progressCallback = null) {
    this._ensureInitialized();

    const results = [];
    const totalFiles = files.length;

    for (let i = 0; i < totalFiles; i++) {
      const file = files[i];

      if (progressCallback) {
        const progress = Math.round((i / totalFiles) * 100);
        progressCallback(`Adding ${file.path}...`, progress);
      }

      try {
        const result = this.add(file.path, file.content, {
          binary: file.isBinary || false
        });
        results.push({
          path: file.path,
          success: true,
          hash: result.hash
        });
      } catch (error) {
        results.push({
          path: file.path,
          success: false,
          error: error.message
        });
      }
    }

    if (progressCallback) {
      progressCallback('All files added', 100);
    }

    // Return format expected by UI
    const successfulResults = results.filter(r => r.success);
    return {
      addedCount: successfulResults.length,
      unchangedCount: 0, // Not tracking this in current implementation
      results: results
    };
  }

  /**
   * Get files from a specific commit
   */
  async getCommitFiles(commitHash) {
    this._ensureInitialized();

    const commit = getCommit(commitHash, this.store);
    if (!commit) {
      throw new Error(`Commit ${commitHash} not found`);
    }

    const tree = getTree(commit.tree, this.store);
    if (!tree) {
      throw new Error(`Tree ${commit.tree} not found`);
    }

    const files = [];
    for (const [path, entry] of Object.entries(tree)) {
      try {
        const content = getFile(entry.hash, this.store);
        files.push({
          path,
          content,
          size: entry.size || content.length,
          binary: entry.binary || false,
          hash: entry.hash
        });
      } catch (error) {
        this.log(`Error retrieving file ${path}: ${error.message}`, 'error');
      }
    }

    return files;
  }

  /**
   * Get staged files with their content
   */
  async getStagedFiles() {
    this._ensureInitialized();

    const staged = [];
    for (const [path, fileInfo] of this.stagingArea.entries()) {
      try {
        const content = getFile(fileInfo.hash, this.store);
        staged.push({
          path,
          name: path, // UI compatibility
          content,
          size: fileInfo.size || content.length,
          binary: fileInfo.binary || false,
          hash: fileInfo.hash
        });
      } catch (error) {
        this.log(`Error retrieving staged file ${path}: ${error.message}`, 'error');
        console.error(`Error retrieving staged file ${path}:`, error);
      }
    }

    return staged;
  }

  /**
   * Get repository statistics
   */
  async getStats() {
    this._ensureInitialized();

    const branches = this.getBranches();
    const history = this.getCommitHistory(100);
    const status = this.status();

    // Get committed file count from latest commit
    let committedFileCount = 0;
    if (history.length > 0) {
      try {
        const latestCommit = await this.getCommitFiles(history[0].hash);
        committedFileCount = latestCommit.length;
      } catch (error) {
        // If error getting commit files, use 0
        committedFileCount = 0;
      }
    }

    return {
      currentBranch: this.getCurrentBranch(),
      totalBranches: branches.length,
      branches: branches.length,  // UI compatibility
      totalCommits: history.length,
      commits: history.length,  // UI compatibility - what the UI actually expects
      files: committedFileCount,  // UI compatibility - committed files in latest commit
      stagedFiles: status.staged.length,
      modifiedFiles: status.modified?.length || 0,
      untrackedFiles: status.untracked?.length || 0,
      branchList: branches,
      recentCommits: history.slice(0, 10)
    };
  }

  /**
   * Export repository as downloadable file
   */
  async exportRepository(name = 'repository') {
    this._ensureInitialized();

    const dbData = this.exportDatabase();

    // Create downloadable file
    const blob = new Blob([dbData], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);

    // Trigger download
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}.webdvcs`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    // Clean up
    URL.revokeObjectURL(url);

    return {
      success: true,
      size: dbData.byteLength,
      name: `${name}.webdvcs`
    };
  }

  /**
   * Load repository from uploaded file
   */
  static async loadFromFile(fileData, progressCallback = null) {
    if (progressCallback) {
      progressCallback('Loading repository...', 0);
    }

    const repo = new BrowserRepo(fileData);
    await repo.init(progressCallback);

    return repo;
  }

  /**
   * Create a new empty repository
   */
  static async create(name = 'new-repo', progressCallback = null) {
    const repo = new BrowserRepo(name);
    await repo.init(progressCallback);
    return repo;
  }
}

// Export for use in browser and worker environments
module.exports = {
  BrowserRepo,
  // Re-export core functions for convenience
  ...browserCore
};

// Make available globally for browser
if (typeof window !== 'undefined') {
  window.WebDVCS = module.exports;
}