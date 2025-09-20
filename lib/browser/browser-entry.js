/**
 * Browser Entry Point - Uses Universal Core for Full CLI Compatibility
 * 
 * This entry point uses the same universal core logic as CLI to ensure
 * 100% compatibility with repositories created by CLI version.
 */

const { BrowserDatabase, initBrowserSQL } = require('./browser-storage.js');

// Import universal core components (same as CLI uses)
const { initStore } = require('../core/storage.js');
const { ContentAddressedRepo: CoreMiniRepo } = require('../core/repo.js');
const { hashData } = require('../core/utils.js');
const { getFile } = require('../core/file-storage.js');
const { getCommit, getTree, getBlob } = require('../core/objects.js');

/**
 * Browser Repository - Browser-specific VCS with clean initialization
 * Uses composition over inheritance to avoid async super() issues
 */
class BrowserRepo {
  constructor(dbPathOrData = 'webdvcs.sqlite', DatabaseConstructor = null) {
    // Store parameters for initialization
    this.dbPathOrData = dbPathOrData;
    this.DatabaseConstructor = DatabaseConstructor;
    this._initialized = false;
    this._coreRepo = null;

    // Browser-specific: logs for web display instead of console
    this.logs = [];
  }

  // Helper method to check initialization
  _ensureInitialized() {
    if (!this._initialized) {
      throw new Error('Repository not initialized. Call init() first.');
    }
  }

  // Initialize repository with proper database constructor
  async init() {
    if (this._initialized && this._coreRepo && this.store) {
      // Repository is already initialized and has valid core repo and store
      return this;
    }

    if (this._initializing) {
      // Prevent concurrent initialization
      throw new Error('Repository initialization already in progress');
    }

    this._initializing = true;

    try {
      // Get browser Database constructor if not provided
      if (!this.DatabaseConstructor) {
        this.DatabaseConstructor = await initBrowserSQL();
      }

    // Create core repository with proper database
    this._coreRepo = new CoreMiniRepo(this.dbPathOrData, false, this.DatabaseConstructor);

    // Delegate core properties
    this.store = this._coreRepo.store;
    this.stagingArea = this._coreRepo.stagingArea;
    this.removedFiles = this._coreRepo.removedFiles;
    this.debugMode = this._coreRepo.debugMode;
    
    // Load existing state from metadata (same as CLI behavior)
    const savedStagingArea = this.store.getMeta('staging_area');
    if (savedStagingArea) {
      // Try to restore staged files from their hashes (pure delta system)
      Object.entries(savedStagingArea).forEach(([path, fileInfo]) => {
        // Use hash directly (pure delta format)
        const hash = fileInfo.hash;
        if (hash) {
          try {
            // Verify file exists by trying to get file content via pure delta system
            const data = getFile(hash, this.store);
            if (data) {
              // Store direct hash reference in staging area (pure delta format)
              this.stagingArea.set(path, {
                hash: hash,
                fileName: path,
                size: fileInfo.size || data.length,
                binary: fileInfo.binary || false
              });
              console.log(`Restored staged file: ${path} (${fileInfo.size || data.length} bytes, hash: ${hash.substring(0, 8)})`);
            } else {
              console.warn(`Warning: Staged file ${path} could not be restored - file not found`);
            }
          } catch (error) {
            console.warn(`Warning: Failed to restore staged file ${path}: ${error.message}`);
          }
        } else {
          console.warn(`Warning: Staged file ${path} missing hash reference`);
        }
      });

      // Only clear metadata if no files were successfully restored
      if (this.stagingArea.size === 0 && Object.keys(savedStagingArea).length > 0) {
        console.warn(`Warning: ${Object.keys(savedStagingArea).length} staged files could not be restored`);
        this.store.setMeta('staging_area', {});
      }
    }
    
    const savedRemovedFiles = this.store.getMeta('removed_files');
    if (savedRemovedFiles && Array.isArray(savedRemovedFiles)) {
      savedRemovedFiles.forEach(fileName => {
        this.removedFiles.add(fileName);
      });
    }
    
    const savedCurrentCommit = this.store.getMeta('current_commit');
    if (savedCurrentCommit) {
      this.currentCommit = savedCurrentCommit;
    }
    
    // Ensure main branch exists - use proper branch existence check
    const branches = this._coreRepo.listBranches();
    const mainBranchExists = branches.some(branch => branch.name === 'main');
    if (!mainBranchExists) {
      this._coreRepo.createBranch('main');
      this.store.setMeta('current_branch', 'main');
    }
    
    // Initialize repository metadata
    if (!this.store.getMeta('repository_name')) {
      this.store.setMeta('repository_name', 'WebDVCS Repository');
    }
    
      this._initialized = true;
      this._initializing = false;
      this.addLog('Repository initialized with clean inheritance');
      return this;
    } catch (error) {
      this._initializing = false;
      throw error;
    }
  }

  // HTML compatibility alias
  get storage() { 
    return this.store; 
  }

  // Delegate core methods with browser-specific logging
  addFile(fileName, content, forceBinary = false) {
    this._ensureInitialized();
    const result = this._coreRepo.addFile(fileName, content, forceBinary);
    this.addLog(`Added ${fileName} ${result.binary ? '(binary)' : '(text)'} - ${result.size} bytes`);
    return result;
  }

  commit(message, author = 'Browser User', email = '') {
    this._ensureInitialized();
    const result = this._coreRepo.commit(message, author, email);
    this.addLog(`Created commit ${result.commitHash.substring(0, 8)} on branch '${result.branch}'`);
    return result;
  }

  checkout(commitHash, fileName = null, writeToDisk = false) {
    this._ensureInitialized();
    const result = this._coreRepo.checkout(commitHash, fileName, false); // Never write to disk in browser
    if (fileName) {
      this.addLog(`Checked out file ${fileName} from commit ${commitHash.substring(0, 8)}`);
    } else {
      this.addLog(`Checked out commit ${commitHash.substring(0, 8)} (${Object.keys(result.files || {}).length} files)`);
    }
    return result;
  }

  switchBranch(name) {
    this._ensureInitialized();
    const result = this._coreRepo.switchBranch(name);
    this.addLog(`Switched to branch '${result.branch}'`);
    return result;
  }

  createBranch(name, fromCommitHash = null) {
    this._ensureInitialized();
    const result = this._coreRepo.createBranch(name, fromCommitHash);
    this.addLog(`Created branch '${name}'`);
    return result;
  }

  // Core method delegations
  getStagedFiles() {
    this._ensureInitialized();
    return Array.from(this._coreRepo.stagingArea.keys()).sort();
  }

  log(maxCount = 10) {
    this._ensureInitialized();
    return this._coreRepo.log(maxCount);
  }

  getCommitHistory(limit = 50) {
    this._ensureInitialized();
    return this._coreRepo.getCommitHistory(limit);
  }

  listCommitFiles(commitHash) {
    this._ensureInitialized();

    // Get the commit object
    const commit = getCommit(commitHash, this._coreRepo.store);
    if (!commit) {
      throw new Error(`Commit ${commitHash} not found`);
    }

    // Get the tree for this commit
    const tree = getTree(commit.tree, this._coreRepo.store);

    // Return list of files (filter out directories)
    return tree
      .filter(entry => entry.type === 'file')
      .map(entry => ({
        name: entry.name,
        hash: entry.hash,
        size: entry.size || 0,
        binary: entry.binary || false
      }));
  }

  getCurrentBranch() {
    this._ensureInitialized();
    return this._coreRepo.getCurrentBranch();
  }

  listBranches() {
    this._ensureInitialized();
    const branches = this._coreRepo.listBranches();
    const currentBranch = this.getCurrentBranch();

    // Add current branch information to the array
    const branchesWithCurrent = branches.map(branch => ({
      ...branch,
      current: branch.name === currentBranch
    }));

    // Add current property to the array itself for web interface compatibility
    branchesWithCurrent.current = currentBranch;

    return branchesWithCurrent;
  }

  deleteBranch(name) {
    this._ensureInitialized();
    return this._coreRepo.deleteBranch(name);
  }

  getFile(fileName) {
    this._ensureInitialized();
    return this._coreRepo.getFile(fileName);
  }

  removeFile(fileName) {
    this._ensureInitialized();
    const result = this._coreRepo.removeFile(fileName);
    this.addLog(`Removed ${fileName}`);
    return result;
  }

  checkoutFile(commitHash, fileName, writeToDisk = false) {
    this._ensureInitialized();
    return this._coreRepo.checkoutFile(commitHash, fileName, false); // Never write to disk in browser
  }

  // Web interface compatibility aliases
  getCommits(limit = 50) {
    return this.getCommitHistory(limit);
  }

  getCommitFiles(commitHash) {
    return this.listCommitFiles(commitHash);
  }

  clearStagingArea() {
    this._ensureInitialized();
    this._coreRepo.clearStagingArea();
    this.addLog('Staging area cleared');
  }

  // Progress callback stub (web interface expects this)
  setProgressCallback(callback) {
    this.progressCallback = callback;
  }

  // Clean up resources and free memory
  close() {
    try {
      // Clear staging areas
      if (this._coreRepo) {
        if (this._coreRepo.fileManager) {
          this._coreRepo.fileManager.stagingArea.clear();
          this._coreRepo.fileManager.removedFiles.clear();
        }

        // Close database connection
        if (this._coreRepo.store && this._coreRepo.store.close) {
          this._coreRepo.store.close();
        }
      }

      // Clear logs
      this.logs = [];

      // Clear references
      this._coreRepo = null;
      this._initialized = false;
    } catch (error) {
      console.error('Error during repository cleanup:', error);
    }
  }

  // Web interface compatibility - delegate to init()
  async createRepository(repoName = 'webdvcs.sqlite') {
    await this.init();
    this.store.setMeta('repository_name', repoName);
    this.repoName = repoName;
    return this;
  }

  // Web interface compatibility - reinitialize with new data
  async loadRepository(data) {
    this.dbPathOrData = data;
    this._initialized = false;
    return this.init();
  }

  getFileContent(fileName) {
    this._ensureInitialized();
    try {
      return this._coreRepo.getFile(fileName);
    } catch (error) {
      console.warn(`Failed to get file content for ${fileName}:`, error);
      return null;
    }
  }

  listCommittedFiles(commitHash) {
    this._ensureInitialized();
    const files = this._coreRepo.listCommitFiles(commitHash);
    return files.map(fileName => ({
      name: fileName,
      type: 'file'
    }));
  }

  getFileFromCommit(fileName, commitHash) {
    this._ensureInitialized();
    try {
      // Get the commit object
      const commit = getCommit(commitHash, this._coreRepo.store);
      if (!commit) {
        throw new Error('Commit not found');
      }

      // Get the tree for this commit
      const tree = getTree(commit.tree, this._coreRepo.store);

      // Find the file in the tree
      const entry = tree.find(e => e.name === fileName);
      if (!entry) {
        throw new Error('File not found in commit');
      }

      // Get the blob content
      return getBlob(entry.hash, this._coreRepo.store);
    } catch (error) {
      console.warn(`Failed to get file ${fileName} from commit ${commitHash}:`, error);
      return null;
    }
  }

  getStats() {
    this._ensureInitialized();
    const coreStats = this.store.getStats();

    // Get commit count - count all commit objects in the objects table
    let commitCount = 0;
    try {
      const commitsCount = this.store.db.prepare("SELECT COUNT(*) as count FROM objects WHERE type = 'commit'").get();
      commitCount = commitsCount ? commitsCount.count : 0;
    } catch (error) {
      commitCount = 0;
    }

    // Get file count - count unique files in current HEAD commit
    let fileCount = 0;
    try {
      const currentBranch = this.getCurrentBranch();
      const ref = this.store.getRef(`refs/heads/${currentBranch}`);
      if (ref && ref.hash) {
        const files = this.listCommitFiles(ref.hash);
        fileCount = files ? files.length : 0;
      }
    } catch (error) {
      // If there's an error getting files, default to 0
      fileCount = 0;
    }

    // Get branch count
    const branches = this.listBranches();
    const branchCount = branches ? branches.length : 1;

    return {
      ...coreStats,
      commits: commitCount,
      files: fileCount,
      branches: branchCount,
      repositoryName: this.store.getMeta('repository_name') || 'WebDVCS Repository',
      lastActivity: Math.max(...this.logs.map(l => l.timestamp), 0) || Date.now()
    };
  }

  // Browser-specific: Get storage analytics including compression ratios
  getStorageAnalytics() {
    this._ensureInitialized();

    try {
      // Get total objects and sizes
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

      return {
        totalObjects,
        totalSize: totalCompressed, // Size on disk (compressed)
        uncompressedSize: totalUncompressed,
        compressionRatio,
        objectBreakdown
      };
    } catch (error) {
      console.error('Failed to get storage analytics:', error);
      return {
        totalObjects: 0,
        totalSize: 0,
        uncompressedSize: 0,
        compressionRatio: 0,
        objectBreakdown: { blob: 0, tree: 0, commit: 0 }
      };
    }
  }

  // Browser-specific: Add log entry for web display
  addLog(message, type = 'info') {
    this.logs.push({
      message,
      type,
      timestamp: Date.now()
    });
  }

  // Browser-specific: Get logs for web display
  getLogs() {
    return this.logs;
  }

  // Browser-specific: Clear logs
  clearLogs() {
    this.logs = [];
  }


  // Branch export/import operations - delegate to core repo
  exportBranchToFile(branchName) {
    this._ensureInitialized();
    return this._coreRepo.exportBranchToFile(branchName);
  }

  importBranchFromFile(binaryData) {
    this._ensureInitialized();
    return this._coreRepo.importBranchFromFile(binaryData);
  }

  // Browser-specific: Add file from File object
  async addFileFromBlob(fileName, blob, forceBinary = false) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const arrayBuffer = e.target.result;
          const uint8Array = new Uint8Array(arrayBuffer);
          const result = this.addFile(fileName, uint8Array, forceBinary);
          resolve(result);
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsArrayBuffer(blob);
    });
  }

  // Browser-specific: Get file as blob for download
  getFileAsBlob(fileName, mimeType = 'application/octet-stream') {
    const fileData = this._coreRepo.getFile(fileName);
    if (!fileData) {
      throw new Error(`File not found: ${fileName}`);
    }

    return new Blob([fileData], { type: mimeType });
  }

  // Browser-specific: Export repository as SQLite blob (optimized)
  exportRepository() {
    if (!this.store.db || typeof this.store.db.export !== 'function') {
      throw new Error('Repository export not available - database not properly initialized');
    }

    try {
      // Clear any temporary staging area data before export to minimize size
      if (this.stagingArea.size === 0) {
        this.store.setMeta('staging_area', {});
      }

      // VACUUM database to minimize export size
      this.store.db.exec('VACUUM');

      // Export optimized database
      const dbData = this.store.db.export();
      return new Blob([dbData], { type: 'application/x-sqlite3' });

    } catch (error) {
      this.addLog(`Export error: ${error.message}`, 'error');
      throw new Error(`Failed to export repository: ${error.message}`);
    }
  }

  // Database optimization: VACUUM to reclaim space and optimize performance
  optimizeDatabase() {
    this._ensureInitialized();

    try {
      const sizeBefore = this.exportRepository().size;
      this.store.db.exec('VACUUM');
      const sizeAfter = this.exportRepository().size;

      const savings = sizeBefore - sizeAfter;
      const savingsPercent = sizeBefore > 0 ? (savings / sizeBefore) * 100 : 0;

      this.addLog(`Database optimized - reclaimed ${(savings / 1024).toFixed(1)} KB (${savingsPercent.toFixed(1)}%)`);

      return {
        sizeBefore,
        sizeAfter,
        savings,
        savingsPercent
      };
    } catch (error) {
      this.addLog(`Database optimization failed: ${error.message}`, 'error');
      throw error;
    }
  }

  // Get detailed size analysis of repository
  getDetailedSizeAnalysis() {
    this._ensureInitialized();

    try {
      // Get database size
      const dbBlob = this.exportRepository();
      const dbSize = dbBlob.size;

      // Get blob statistics
      const blobStats = this.store.db.prepare(`
        SELECT
          COUNT(*) as blob_count,
          SUM(size) as total_original_size,
          SUM(LENGTH(content)) as total_compressed_size,
          AVG(size) as avg_original_size,
          AVG(LENGTH(content)) as avg_compressed_size
        FROM blob
      `).get();

      // Get delta compression statistics
      const deltaStats = this.store.db.prepare(`
        SELECT
          COUNT(*) as total_deltas,
          AVG(original_size) as avg_original_size,
          COUNT(DISTINCT base_rid) as unique_bases
        FROM deltas
      `).get();

      // Calculate efficiency metrics
      const originalSize = blobStats.total_original_size || 0;
      const compressedSize = blobStats.total_compressed_size || 0;
      const dbOverhead = dbSize - compressedSize;

      const compressionRatio = originalSize > 0 ? (compressedSize / originalSize) : 0;
      const overheadPercent = dbSize > 0 ? (dbOverhead / dbSize) * 100 : 0;
      const sizeMultiplier = originalSize > 0 ? (dbSize / originalSize) : 0;

      return {
        // Size metrics
        originalSize,
        compressedSize,
        dbSize,
        dbOverhead,

        // Efficiency metrics
        compressionRatio,
        overheadPercent,
        sizeMultiplier,

        // Statistics
        blobCount: blobStats.blob_count || 0,
        totalDeltas: deltaStats.total_deltas || 0,
        uniqueBases: deltaStats.unique_bases || 0,
        avgDeltaOriginalSize: deltaStats.avg_original_size || 0,

        // Human readable
        originalSizeMB: (originalSize / (1024 * 1024)).toFixed(2),
        compressedSizeMB: (compressedSize / (1024 * 1024)).toFixed(2),
        dbSizeMB: (dbSize / (1024 * 1024)).toFixed(2),
        dbOverheadKB: (dbOverhead / 1024).toFixed(1),
        compressionPercent: (compressionRatio * 100).toFixed(1),

        // Assessment
        isEfficient: sizeMultiplier < 1.2,
        needsOptimization: overheadPercent > 10
      };
    } catch (error) {
      this.addLog(`Size analysis failed: ${error.message}`, 'error');
      throw error;
    }
  }

  // Get size analysis summary for display
  getSizeSummary() {
    try {
      const analysis = this.getDetailedSizeAnalysis();
      return {
        summary: `${analysis.originalSizeMB}MB → ${analysis.dbSizeMB}MB (${(analysis.sizeMultiplier).toFixed(2)}x)`,
        compression: `${analysis.compressionPercent}% compression ratio`,
        overhead: `${analysis.overheadPercent.toFixed(1)}% database overhead`,
        status: analysis.isEfficient ? '✅ Efficient' : '⚠️ High overhead',
        recommendation: analysis.needsOptimization ? 'Consider running database optimization' : 'Storage is optimal'
      };
    } catch (error) {
      return {
        summary: 'Analysis unavailable',
        compression: 'Unknown',
        overhead: 'Unknown',
        status: '❌ Error',
        recommendation: `Analysis failed: ${error.message}`
      };
    }
  }

}


// Export for webpack library
const WebDVCSExport = {
  BrowserRepo,
  initStore,
  BrowserDatabase,
  initBrowserSQL,
  hashData
};

// Also set on global for direct HTML usage
if (typeof window !== 'undefined') {
  window.WebDVCS = WebDVCSExport;
}

// Export for CommonJS/webpack
module.exports = WebDVCSExport;