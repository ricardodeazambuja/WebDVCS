/**
 * Content-Addressed Repository Implementation
 * Simplified repo API using v2 content-addressed storage
 */

const { ContentAddressedStore } = require('./storage');
const {
  storeBlob,
  getBlob,
  storeTree,
  getTree,
  createCommit,
  getCommit,
  getCommitHistory
} = require('./objects');
const BranchTransfer = require('./branch-transfer-true-fix');
const { isBinary } = require('./utils');
const { diffFiles } = require('./diff');

class ContentAddressedRepo {
  constructor(dbPath = 'webdvcs.sqlite', debugMode = false, DatabaseConstructor = null) {
    this.store = new ContentAddressedStore(dbPath, DatabaseConstructor);
    this.debugMode = debugMode;

    // Staging area - files ready to commit
    this.stagingArea = new Map(); // fileName -> {hash, binary, size}
    this.removedFiles = new Set(); // Files marked for deletion

    // Branch transfer for import/export
    this.branchTransfer = new BranchTransfer(this.store);

    // Ensure main branch exists (but don't create it with null hash)
    if (!this.store.getRef('refs/heads/main')) {
      this.store.setMeta('current_branch', 'main');
    }

    // Load staging area from metadata
    this._loadStagingArea();
  }

  // ===== Core Repository Operations =====

  /**
   * Add file to staging area
   * @param {string} fileName - File name/path
   * @param {Uint8Array|string} content - File content
   * @param {boolean} forceBinary - Force binary mode
   * @returns {Object} - Add result
   */
  addFile(fileName, content, forceBinary = false) {
    if (this.debugMode) {
      console.log(`🔍 Adding file: ${fileName}`);
    }

    // Convert content to Uint8Array
    const contentArray = typeof content === 'string'
      ? new TextEncoder().encode(content)
      : new Uint8Array(content);

    // Detect if binary
    const binary = forceBinary || isBinary(contentArray);

    // Store blob
    const result = storeBlob(contentArray, this.store);

    if (this.debugMode) {
      console.log(`🔍 Stored blob for ${fileName}: ${result.hash ? result.hash.substring(0, 8) : 'null'} (${contentArray.length} bytes, ${binary ? 'binary' : 'text'})`);
    }

    // Add to staging area
    this.stagingArea.set(fileName, {
      hash: result.hash,
      binary: binary,
      size: contentArray.length
    });

    // Remove from deleted files if it was marked for deletion
    this.removedFiles.delete(fileName);

    // Save staging area
    this._saveStagingArea();

    return {
      fileName,
      hash: result.hash,
      binary,
      size: contentArray.length,
      isNew: result.isNew
    };
  }

  /**
   * Remove file (mark for deletion)
   * @param {string} fileName - File name to remove
   * @returns {boolean} - True if removal succeeded, false if file doesn't exist or already removed
   */
  removeFile(fileName) {
    // Check if file is already marked for removal
    if (this.removedFiles.has(fileName)) {
      return false;
    }

    // Check if file exists in staging area or current commit
    const inStaging = this.stagingArea.has(fileName);

    let inCommit = false;
    const currentBranch = this.getCurrentBranch();
    const ref = this.store.getRef(`refs/heads/${currentBranch}`);
    if (ref && ref.hash) {
      const commit = getCommit(ref.hash, this.store);
      if (commit) {
        const tree = getTree(commit.tree, this.store);
        inCommit = tree.some(entry => entry.name === fileName);
      }
    }

    // If file doesn't exist anywhere, return false
    if (!inStaging && !inCommit) {
      return false;
    }

    // Remove from staging area if present
    this.stagingArea.delete(fileName);

    // Mark for deletion (Git-like behavior: track removal of any file, staged or committed)
    this.removedFiles.add(fileName);

    // Save changes
    this._saveStagingArea();

    return true;
  }

  /**
   * Remove files (CLI-style method expecting array or single file)
   * @param {Array|string} fileNames - Array of file names or single file name to remove
   * @returns {Object|boolean} - For arrays: {removed: count}, for single files: boolean
   */
  rm(fileNames) {
    const isArray = Array.isArray(fileNames);
    const files = isArray ? fileNames : [fileNames];
    let removedCount = 0;

    for (const fileName of files) {
      const result = this.removeFile(fileName);
      if (result) {
        removedCount++;
      }
    }

    // Return different formats based on input type
    if (isArray) {
      return { removed: removedCount };
    } else {
      return removedCount > 0;
    }
  }

  /**
   * Unstage file (remove from staging area)
   * @param {string} fileName - File name to unstage
   */
  unstage(fileName) {
    const wasStaged = this.stagingArea.delete(fileName);
    const wasRemoved = this.removedFiles.delete(fileName);

    if (wasStaged || wasRemoved) {
      this._saveStagingArea();
      return {
        action: wasRemoved ? 'unremoved' : 'unstaged',
        file: fileName
      };
    }

    return {
      action: 'not_found',
      file: fileName
    };
  }

  /**
   * Get file content
   * @param {string} fileName - File name
   * @param {string} commitHash - Optional commit hash
   * @returns {Uint8Array} - File content
   */
  getFile(fileName, commitHash = null) {
    if (commitHash) {
      // Get from specific commit
      const commit = getCommit(commitHash, this.store);
      if (!commit) throw new Error('Commit not found');

      const tree = getTree(commit.tree, this.store);
      const entry = tree.find(e => e.name === fileName);
      if (!entry) throw new Error('File not found in commit');

      return getBlob(entry.hash, this.store);
    } else {
      // Check if file is marked for deletion
      if (this.removedFiles.has(fileName)) {
        throw new Error('File not staged');
      }

      // Get from staging area first
      const staged = this.stagingArea.get(fileName);
      if (staged) {
        return getBlob(staged.hash, this.store);
      }

      // Fall back to current commit if not staged and not marked for deletion
      const currentBranch = this.getCurrentBranch();
      const ref = this.store.getRef(`refs/heads/${currentBranch}`);

      if (!ref || !ref.hash) {
        throw new Error('File not staged');
      }

      const commit = getCommit(ref.hash, this.store);
      if (!commit) {
        throw new Error('File not staged');
      }

      const tree = getTree(commit.tree, this.store);
      const entry = tree.find(e => e.name === fileName);
      if (!entry) {
        throw new Error('File not staged');
      }

      return getBlob(entry.hash, this.store);
    }
  }

  /**
   * Get file metadata from current repository commit (HEAD)
   * @returns {Map} - Map of file names to metadata
   */
  getHeadFileMetadata() {
    const currentBranch = this.getCurrentBranch();
    const ref = this.store.getRef(`refs/heads/${currentBranch}`);

    if (!ref || !ref.hash) {
      return new Map(); // No commits yet
    }

    const commit = getCommit(ref.hash, this.store);
    if (!commit) {
      return new Map();
    }

    const tree = getTree(commit.tree, this.store);
    const metadata = new Map();

    for (const entry of tree) {
      if (entry.type === 'file') {
        metadata.set(entry.name, {
          hash: entry.hash,
          mode: entry.mode,
          size: entry.size,
          type: entry.type,
          binary: entry.binary
        });
      }
    }

    return metadata;
  }

  /**
   * List files in the repository from current commit
   * @param {string} dirPath - Directory path to list (optional)
   * @param {Object} options - Listing options (optional)
   * @returns {Object} - {files: Array, directories: Array, metadata: {hasCommits: boolean}}
   */
  listRepoFiles(dirPath = '', options = {}) {
    const currentBranch = this.getCurrentBranch();
    const ref = this.store.getRef(`refs/heads/${currentBranch}`);

    if (!ref || !ref.hash) {
      return { files: [], directories: [], metadata: { hasCommits: false } };
    }

    const commit = getCommit(ref.hash, this.store);
    if (!commit) {
      return { files: [], directories: [], metadata: { hasCommits: false } };
    }

    const tree = getTree(commit.tree, this.store);
    const normalizedPath = dirPath.replace(/^\/+|\/+$/g, '');
    const searchPath = normalizedPath ? normalizedPath + '/' : '';

    const files = [];
    const directories = new Set();

    for (const entry of tree) {
      if (!entry || !entry.name) {
        continue; // Skip malformed entries
      }

      if (normalizedPath && !entry.name.startsWith(searchPath)) {
        continue;
      }

      const relativePath = normalizedPath ?
        entry.name.substring(searchPath.length) :
        entry.name;

      if (!relativePath) {
        continue;
      }

      if (entry.type === 'file') {
        // Check if file is in subdirectory
        const pathParts = relativePath.split('/');
        if (pathParts.length === 1) {
          // File is directly in requested directory
          files.push({
            name: entry.name,
            hash: entry.hash,
            size: entry.size || 0,
            binary: entry.binary || false,
            mode: entry.mode || 100644
          });
        } else {
          // File is in subdirectory - add the subdirectory
          directories.add(pathParts[0]);
        }
      }
    }

    return {
      files: files.sort((a, b) => a.name.localeCompare(b.name)),
      directories: Array.from(directories).sort(),
      metadata: { hasCommits: true }
    };
  }

  /**
   * List staged files, or files from current commit if staging area is empty
   * @returns {Array} - Array of file names
   */
  listFiles() {
    // If staging area has files, return those
    if (this.stagingArea.size > 0) {
      return Array.from(this.stagingArea.keys()).sort();
    }

    // Otherwise, return files from current branch's HEAD commit
    const currentBranch = this.getCurrentBranch();
    const ref = this.store.getRef(`refs/heads/${currentBranch}`);

    if (!ref || !ref.hash) {
      return []; // No commits yet
    }

    const commit = getCommit(ref.hash, this.store);
    if (!commit) {
      return [];
    }

    const tree = getTree(commit.tree, this.store);
    return tree
      .filter(entry => entry.type === 'file')
      .map(entry => entry.name)
      .sort();
  }

  /**
   * Create commit from staging area
   * @param {string} message - Commit message
   * @param {string} author - Author name
   * @param {string} email - Author email
   * @returns {Object} - Commit result
   */
  commit(message, author = null, email = null) {
    if (this.debugMode) {
      console.log(`🔍 Starting commit: "${message}" with ${this.stagingArea.size} staged files and ${this.removedFiles.size} removed files`);
    }

    if (this.stagingArea.size === 0 && this.removedFiles.size === 0) {
      throw new Error('Nothing to commit');
    }

    // Get author info
    if (!author) {
      author = this.store.getMeta('author.name') || 'Unknown';
      email = this.store.getMeta('author.email') || 'unknown@example.com';
    }

    if (this.debugMode) {
      console.log(`🔍 Committing as ${author} <${email}>`);
    }

    // Get current branch and head
    const currentBranch = this.getCurrentBranch();
    const currentHead = this.store.getRef(`refs/heads/${currentBranch}`);
    const parentHash = currentHead ? currentHead.hash : null;

    // Build tree from staging area (excluding removed files)
    const treeEntries = [];

    // Add files from current HEAD that aren't staged or removed
    if (parentHash) {
      const parentCommit = getCommit(parentHash, this.store);
      const parentTree = getTree(parentCommit.tree, this.store);

      for (const entry of parentTree) {
        if (!this.stagingArea.has(entry.name) && !this.removedFiles.has(entry.name)) {
          treeEntries.push(entry);
        }
      }
    }

    // Add staged files
    for (const [fileName, fileInfo] of this.stagingArea) {
      treeEntries.push({
        name: fileName,
        type: 'file',
        hash: fileInfo.hash,
        mode: 100644,
        size: fileInfo.size,
        binary: fileInfo.binary
      });
    }

    // Create tree
    const treeHash = storeTree(treeEntries, this.store);

    // Create commit
    const commitHash = createCommit(treeHash, message, author, email, parentHash, this.store);

    // Update branch reference
    this.store.setRef(`refs/heads/${currentBranch}`, commitHash, 'branch');

    // Clear staging area
    this.stagingArea.clear();
    this.removedFiles.clear();
    this._saveStagingArea();

    return {
      commitHash,
      treeHash,
      message,
      author,
      timestamp: Math.floor(Date.now() / 1000),
      branch: currentBranch
    };
  }

  // ===== Branch Operations =====

  /**
   * Get current branch name
   * @returns {string} - Branch name
   */
  getCurrentBranch() {
    return this.store.getMeta('current_branch') || 'main';
  }

  /**
   * List all branches
   * @returns {Array} - Branch objects
   */
  listBranches() {
    const refs = this.store.listRefs();
    const branches = refs
      .filter(ref => ref.name.startsWith('refs/heads/'))
      .map(ref => ({
        name: ref.name.replace('refs/heads/', ''),
        head: ref.hash,
        current: ref.name === `refs/heads/${this.getCurrentBranch()}`
      }));

    // Include current branch even if it has no commits
    const currentBranch = this.getCurrentBranch();
    const currentExists = branches.some(b => b.name === currentBranch);
    if (!currentExists) {
      branches.push({
        name: currentBranch,
        head: null,
        current: true
      });
    }

    return branches;
  }

  /**
   * Create new branch
   * @param {string} name - Branch name
   * @param {string} fromCommit - Source commit hash
   * @returns {string} - Branch name
   */
  createBranch(name, fromCommit = null) {
    // Check if branch already exists
    const existingRef = this.store.getRef(`refs/heads/${name}`);
    if (existingRef) {
      throw new Error(`Branch '${name}' already exists`);
    }

    if (!fromCommit) {
      const currentBranch = this.getCurrentBranch();
      const currentRef = this.store.getRef(`refs/heads/${currentBranch}`);
      fromCommit = currentRef ? currentRef.hash : null;
    }

    // Can't create a branch without a commit to point to
    if (!fromCommit) {
      throw new Error('Cannot create branch: no commits exist yet');
    }

    this.store.setRef(`refs/heads/${name}`, fromCommit, 'branch');
    return name;
  }

  /**
   * Switch to branch
   * @param {string} name - Branch name
   * @returns {Object} - Switch result
   */
  switchBranch(name) {
    const ref = this.store.getRef(`refs/heads/${name}`);
    if (!ref) {
      throw new Error(`Branch '${name}' does not exist`);
    }

    this.store.setMeta('current_branch', name);

    // Clear staging area when switching branches
    this.stagingArea.clear();
    this.removedFiles.clear();
    this._saveStagingArea();

    return {
      branch: name,
      head: ref.hash
    };
  }

  /**
   * Delete branch and optionally run garbage collection
   * @param {string} name - Branch name
   * @param {boolean} runGC - Whether to run garbage collection after deletion
   * @returns {Object} - Deletion result with garbage collection stats
   */
  deleteBranch(name, runGC = true) {
    if (name === this.getCurrentBranch()) {
      throw new Error('Cannot delete current branch');
    }

    const deleted = this.store.removeRef(`refs/heads/${name}`);
    if (!deleted) {
      throw new Error(`Branch '${name}' does not exist`);
    }

    let gcStats = null;
    if (runGC) {
      gcStats = this.garbageCollect();
    }

    return {
      branch: name,
      deleted: true,
      garbageCollection: gcStats
    };
  }

  /**
   * Run garbage collection to remove unreachable objects
   * @returns {Object} - Garbage collection statistics
   */
  garbageCollect() {
    const startTime = Date.now();

    // Get all reachable objects from all branch heads
    const reachableObjects = new Set();
    const allRefs = this.store.listRefs();

    for (const ref of allRefs) {
      if (ref.name.startsWith('refs/heads/') && ref.hash) {
        const { collectReachableObjects } = require('./objects');
        const reachable = collectReachableObjects(ref.hash, this.store);
        for (const hash of reachable) {
          reachableObjects.add(hash);
        }
      }
    }

    // Get all objects in the database
    const allObjects = this.store.db.prepare('SELECT hash FROM objects').all();
    const totalObjects = allObjects.length;

    // Find unreachable objects
    const unreachableObjects = [];
    for (const obj of allObjects) {
      if (!reachableObjects.has(obj.hash)) {
        unreachableObjects.push(obj.hash);
      }
    }

    // Delete unreachable objects
    let deletedCount = 0;
    if (unreachableObjects.length > 0) {
      const deleteStmt = this.store.db.prepare('DELETE FROM objects WHERE hash = ?');
      for (const hash of unreachableObjects) {
        deleteStmt.run(hash);
        deletedCount++;
      }
    }

    const endTime = Date.now();
    return {
      totalObjects,
      reachableObjects: reachableObjects.size,
      deletedObjects: deletedCount,
      duration: endTime - startTime
    };
  }

  /**
   * Delete a specific commit and run garbage collection
   * @param {string} commitHash - Commit hash to delete
   * @returns {Object} - Deletion result
   */
  deleteCommit(commitHash) {
    // Check if commit exists
    const { getCommit } = require('./objects');
    const commit = getCommit(commitHash, this.store);
    if (!commit) {
      throw new Error('Commit not found');
    }

    // Check if commit is referenced by any branch
    const allRefs = this.store.listRefs();
    for (const ref of allRefs) {
      if (ref.name.startsWith('refs/heads/') && ref.hash === commitHash) {
        throw new Error(`Cannot delete commit: it is the head of branch '${ref.name.replace('refs/heads/', '')}'`);
      }
    }

    // Check if commit is in the history of any branch
    const { getCommitHistory } = require('./objects');
    for (const ref of allRefs) {
      if (ref.name.startsWith('refs/heads/') && ref.hash) {
        const history = getCommitHistory(ref.hash, 1000, this.store);
        if (history.some(c => c.hash === commitHash)) {
          throw new Error('Cannot delete commit: it is reachable from existing branches');
        }
      }
    }

    // If we get here, the commit is not reachable from any branch
    // Delete the commit object directly
    this.store.removeObject(commitHash);

    // Run garbage collection to clean up any orphaned objects
    const gcStats = this.garbageCollect();

    return {
      commit: commitHash,
      deleted: true,
      garbageCollection: gcStats
    };
  }

  // ===== Checkout Operations =====

  /**
   * Checkout files from a specific commit into staging area
   * @param {string} commitHash - Commit hash to checkout
   * @param {string} fileName - Optional specific file to checkout
   * @param {boolean} writeToDisk - Whether to write to disk (CLI feature)
   * @returns {Object} - Checkout result
   */
  checkout(commitHash, fileName = null, writeToDisk = false) {
    const commit = getCommit(commitHash, this.store);
    if (!commit) {
      throw new Error('Commit not found');
    }

    if (fileName) {
      // Single file checkout
      const tree = getTree(commit.tree, this.store);
      const entry = tree.find(e => e.name === fileName);
      if (!entry) {
        throw new Error(`File '${fileName}' not found in commit`);
      }

      const content = getBlob(entry.hash, this.store);

      // Add to staging area
      this.stagingArea.set(fileName, {
        hash: entry.hash,
        binary: entry.binary || false,
        size: entry.size || content.length
      });
      this.removedFiles.delete(fileName);
      this._saveStagingArea();

      return {
        content,
        metadata: {
          mode: entry.mode,
          mtime: entry.mtime,
          size: entry.size,
          type: entry.type
        }
      };
    } else {
      // Full commit checkout - populate staging area with all files
      const tree = getTree(commit.tree, this.store);

      // Clear staging area
      this.stagingArea.clear();
      this.removedFiles.clear();

      // Add all files from commit to staging area and collect file data
      const files = {};
      const filesMetadata = {};

      for (const entry of tree) {
        if (entry.type === 'file') {
          this.stagingArea.set(entry.name, {
            hash: entry.hash,
            binary: entry.binary || false,
            size: entry.size || 0
          });

          // Get file content for the files property
          const content = getBlob(entry.hash, this.store);
          files[entry.name] = content;

          // Store metadata
          filesMetadata[entry.name] = {
            mode: entry.mode,
            mtime: entry.mtime,
            size: entry.size,
            type: entry.type
          };
        }
      }

      this._saveStagingArea();

      return {
        commit: commitHash,
        filesCount: Object.keys(files).length,
        files: files,
        filesMetadata: filesMetadata
      };
    }
  }

  // ===== Commit History =====

  /**
   * Get commit history
   * @param {number} maxCount - Maximum commits to return
   * @returns {Array} - Commit history
   */
  log(maxCount = 10) {
    const currentBranch = this.getCurrentBranch();
    const ref = this.store.getRef(`refs/heads/${currentBranch}`);

    if (!ref || !ref.hash) {
      return [];
    }

    return getCommitHistory(ref.hash, maxCount, this.store);
  }

  // ===== Branch Export/Import =====

  /**
   * Export branch to binary data
   * @param {string} branchName - Branch name
   * @returns {Object} - {data, filename}
   */
  exportBranchToFile(branchName) {
    const exportData = this.branchTransfer.exportBranch(branchName);
    const filename = this.branchTransfer.getExportFilename(branchName);
    return { data: exportData, filename };
  }

  /**
   * Import branch from binary data
   * @param {Uint8Array} binaryData - Export data
   * @returns {Object} - Import statistics
   */
  importBranchFromFile(binaryData) {
    return this.branchTransfer.importBranch(binaryData);
  }

  /**
   * Get export statistics for a branch
   * @param {string} branchName - Branch name
   * @returns {Object} - Export statistics
   */
  getExportStats(branchName) {
    return this.branchTransfer.getExportStats(branchName);
  }

  // ===== Configuration =====

  /**
   * Set author information
   * @param {string} name - Author name
   * @param {string} email - Author email
   */
  setAuthor(name, email = null) {
    if (!name || name.trim() === '') {
      throw new Error('Author name is required');
    }
    this.store.setMeta('author.name', name.trim());
    if (email && email.trim() !== '') {
      this.store.setMeta('author.email', email.trim());
    }
  }

  /**
   * Get author information
   * @returns {Object} - {name, email}
   */
  getAuthor() {
    return {
      name: this.store.getMeta('author.name'),
      email: this.store.getMeta('author.email')
    };
  }

  // ===== Diff Operations =====

  /**
   * Compare two files and return diff
   * @param {string} fileA - First file name
   * @param {string} fileB - Second file name
   * @returns {Object} - Diff result
   */
  diffFiles(fileA, fileB) {
    // Get content of both files from staging area
    const contentA = this.getFile(fileA);
    const contentB = this.getFile(fileB);

    // Use the core diffFiles function (expects Uint8Array)
    return diffFiles(contentA, contentB, fileA, fileB);
  }

  /**
   * Show changes between staging area and last commit
   * @returns {Array} - Array of changes with diff content
   */
  showChanges() {
    const currentBranch = this.getCurrentBranch();
    const ref = this.store.getRef(`refs/heads/${currentBranch}`);

    if (!ref || !ref.hash) {
      // No commits yet - all staged files are additions
      const changes = [];
      for (const [fileName, fileInfo] of this.stagingArea) {
        const content = getBlob(fileInfo.hash, this.store);
        const text = new TextDecoder().decode(content);
        const diff = text.split('\n').map(line => `+${line}`).join('\n');

        changes.push({
          type: 'added',
          file: fileName,
          diff: diff
        });
      }
      return changes;
    }

    // Get current commit tree
    const commit = getCommit(ref.hash, this.store);
    const tree = getTree(commit.tree, this.store);
    const committedFiles = new Map(tree.filter(e => e.type === 'file').map(e => [e.name, e]));

    const changes = [];

    // Check staged files for additions and modifications
    for (const [fileName, fileInfo] of this.stagingArea) {
      const committedFile = committedFiles.get(fileName);

      if (!committedFile) {
        // File is new (added)
        const content = getBlob(fileInfo.hash, this.store);
        const text = new TextDecoder().decode(content);
        const diff = text.split('\n').map(line => `+${line}`).join('\n');

        changes.push({
          type: 'added',
          file: fileName,
          diff: diff
        });
      } else if (committedFile.hash !== fileInfo.hash) {
        // File is modified
        const oldContent = getBlob(committedFile.hash, this.store);
        const newContent = getBlob(fileInfo.hash, this.store);
        const diffResult = diffFiles(oldContent, newContent, fileName, fileName);

        changes.push({
          type: 'modified',
          file: fileName,
          diff: diffResult.content
        });
      }
    }

    // Check for deleted files
    for (const fileName of this.removedFiles) {
      const committedFile = committedFiles.get(fileName);
      if (committedFile) {
        const content = getBlob(committedFile.hash, this.store);
        const text = new TextDecoder().decode(content);
        const diff = text.split('\n').map(line => `-${line}`).join('\n');

        changes.push({
          type: 'deleted',
          file: fileName,
          diff: diff
        });
      }
    }

    return changes;
  }

  /**
   * Compare two commits and return file changes
   * @param {string} commitHashA - First commit hash
   * @param {string} commitHashB - Second commit hash
   * @returns {Array} - Array of file changes
   */
  diffCommits(commitHashA, commitHashB) {
    const commitA = getCommit(commitHashA, this.store);
    const commitB = getCommit(commitHashB, this.store);

    if (!commitA || !commitB) {
      throw new Error('One or both commits not found');
    }

    const treeA = getTree(commitA.tree, this.store);
    const treeB = getTree(commitB.tree, this.store);

    // Create maps for quick lookup
    const filesA = new Map(treeA.filter(e => e.type === 'file').map(e => [e.name, e]));
    const filesB = new Map(treeB.filter(e => e.type === 'file').map(e => [e.name, e]));

    const changes = [];

    // Check for modified and removed files
    for (const [fileName, entryA] of filesA) {
      const entryB = filesB.get(fileName);
      if (!entryB) {
        // File was removed
        const contentA = getBlob(entryA.hash, this.store);
        const contentStr = entryA.binary ? '[Binary content]' : new TextDecoder().decode(contentA);
        changes.push({
          file: fileName,
          type: 'removed',
          hashA: entryA.hash,
          hashB: null,
          diff: `- ${contentStr.split('\n').join('\n- ')}`
        });
      } else if (entryA.hash !== entryB.hash) {
        // File was modified
        const diff = this._generateFileDiff(entryA, entryB);
        changes.push({
          file: fileName,
          type: 'modified',
          hashA: entryA.hash,
          hashB: entryB.hash,
          diff: diff
        });
      }
    }

    // Check for added files
    for (const [fileName, entryB] of filesB) {
      if (!filesA.has(fileName)) {
        // File was added
        const contentB = getBlob(entryB.hash, this.store);
        const contentStr = entryB.binary ? '[Binary content]' : new TextDecoder().decode(contentB);
        changes.push({
          file: fileName,
          type: 'added',
          hashA: null,
          hashB: entryB.hash,
          diff: `+ ${contentStr.split('\n').join('\n+ ')}`
        });
      }
    }

    return changes;
  }

  /**
   * Generate diff content between two file entries
   * @private
   */
  _generateFileDiff(entryA, entryB) {
    const contentA = getBlob(entryA.hash, this.store);
    const contentB = getBlob(entryB.hash, this.store);

    // Handle binary files
    if (entryA.binary || entryB.binary) {
      return 'Binary files differ';
    }

    // Convert to text
    const textA = new TextDecoder().decode(contentA);
    const textB = new TextDecoder().decode(contentB);

    // Simple line-based diff
    const linesA = textA.split('\n');
    const linesB = textB.split('\n');

    const diffLines = [];

    // This is a simplified diff - just show removed and added lines
    // A real diff would show context and be more sophisticated
    const maxLines = Math.max(linesA.length, linesB.length);

    for (let i = 0; i < maxLines; i++) {
      const lineA = linesA[i];
      const lineB = linesB[i];

      if (lineA !== lineB) {
        if (lineA !== undefined) {
          diffLines.push(`- ${lineA}`);
        }
        if (lineB !== undefined) {
          diffLines.push(`+ ${lineB}`);
        }
      }
    }

    return diffLines.length > 0 ? diffLines.join('\n') : 'Files differ but no line changes detected';
  }

  // ===== Repository Status =====

  /**
   * Get repository status
   * @returns {Object} - Repository status
   */
  status() {
    const currentBranch = this.getCurrentBranch();
    const ref = this.store.getRef(`refs/heads/${currentBranch}`);
    const stats = this.store.getStats();

    return {
      current_branch: currentBranch,
      head: ref ? ref.hash : null,
      db_path: stats.dbPath,
      db_size: stats.dbSize,
      objects: stats.objects,
      store_objects: stats.objects, // Alias for test compatibility
      branches: this.listBranches().length,
      staged: Array.from(this.stagingArea.keys()).sort(),
      deleted: Array.from(this.removedFiles)
    };
  }

  // ===== CLI Compatibility Methods =====

  /**
   * Internal file addition without saving (for bulk operations)
   * Compatibility method for CLI filesystem operations
   * @param {string} fileName - File name
   * @param {Uint8Array} content - File content
   * @param {boolean} forceBinary - Force binary mode
   * @param {Object} metadata - File metadata (ignored in v2)
   * @returns {Object} - Add result
   */
  _addFileInternal(fileName, content, forceBinary = false, metadata = null) {
    // Convert content to Uint8Array
    const contentArray = typeof content === 'string'
      ? new TextEncoder().encode(content)
      : new Uint8Array(content);

    // Detect if binary
    const binary = forceBinary || isBinary(contentArray);

    // Store blob
    const result = storeBlob(contentArray, this.store);

    // Add to staging area (but don't save yet - for bulk operations)
    this.stagingArea.set(fileName, {
      hash: result.hash,
      binary: binary,
      size: contentArray.length
    });

    // Remove from deleted files if it was marked for deletion
    this.removedFiles.delete(fileName);

    return {
      fileName,
      hash: result.hash,
      binary,
      size: contentArray.length,
      isNew: result.isNew
    };
  }

  /**
   * Save staging area (called after bulk operations)
   * Compatibility method for CLI
   */
  saveStagingArea() {
    this._saveStagingArea();
  }

  // ===== Internal Methods =====

  /**
   * Load staging area from metadata
   * @private
   */
  _loadStagingArea() {
    const stagingData = this.store.getMeta('staging_area');
    if (stagingData) {
      try {
        const parsed = JSON.parse(stagingData);
        this.stagingArea = new Map(Object.entries(parsed.files || {}));
        this.removedFiles = new Set(parsed.removed || []);
      } catch (error) {
        // Ignore invalid staging data
      }
    }
  }

  /**
   * Save staging area to metadata
   * @private
   */
  _saveStagingArea() {
    const stagingData = {
      files: Object.fromEntries(this.stagingArea),
      removed: Array.from(this.removedFiles)
    };
    this.store.setMeta('staging_area', JSON.stringify(stagingData));
  }

  /**
   * Get current HEAD commit hash
   * @returns {string|null} - Current HEAD commit hash
   */
  getCurrentHead() {
    const currentBranch = this.getCurrentBranch();
    const ref = this.store.getRef(`refs/heads/${currentBranch}`);
    return ref ? ref.hash : null;
  }

  /**
   * Resolve commit reference to actual commit hash
   * @param {string} commitRef - Commit reference (e.g., 'HEAD', 'HEAD~1', direct hash)
   * @returns {string|null} - Resolved commit hash or null if invalid
   */
  resolveCommitReference(commitRef) {
    if (!commitRef) {
      return null;
    }

    // Handle HEAD reference
    if (commitRef === 'HEAD') {
      return this.getCurrentHead();
    }

    // Handle HEAD~n references
    if (commitRef.startsWith('HEAD~')) {
      const stepsBack = parseInt(commitRef.substring(5));
      if (isNaN(stepsBack) || stepsBack < 0) {
        return null;
      }

      const currentHead = this.getCurrentHead();
      if (!currentHead) {
        return null;
      }

      // Walk back through commit history
      let current = currentHead;
      for (let i = 0; i < stepsBack; i++) {
        const commit = getCommit(current, this.store);
        if (!commit || !commit.parent) {
          return null;
        }
        current = commit.parent;
      }
      return current;
    }

    // For direct hashes, validate and return as-is
    if (this.store.hasObject(commitRef)) {
      return commitRef;
    }

    return null;
  }

  /**
   * Reset branch to a specific commit
   * @param {string} commitRef - Commit hash or reference (e.g., 'HEAD~1')
   * @param {Object} options - Reset options {mode: 'soft'|'hard'}
   * @returns {Object} - Reset result
   */
  reset(commitRef, options = {}) {
    const mode = options.mode || 'soft';

    if (!['soft', 'hard'].includes(mode)) {
      throw new Error(`Invalid reset mode: ${mode}`);
    }

    // Resolve commit reference
    let targetCommitHash;
    if (commitRef.startsWith('HEAD~')) {
      const stepsBack = parseInt(commitRef.substring(5));
      const currentHead = this.getCurrentHead();
      if (!currentHead) {
        throw new Error('No commits exist to reset from');
      }

      // Walk back through commit history
      let current = currentHead;
      for (let i = 0; i < stepsBack; i++) {
        const commit = getCommit(current, this.store);
        if (!commit || !commit.parent) {
          throw new Error(`Cannot go back ${stepsBack} commits`);
        }
        current = commit.parent;
      }
      targetCommitHash = current;
    } else {
      targetCommitHash = commitRef;
    }

    // Verify target commit exists
    const targetCommit = getCommit(targetCommitHash, this.store);
    if (!targetCommit) {
      throw new Error(`Commit ${targetCommitHash} not found`);
    }

    // Update branch reference
    const currentBranch = this.getCurrentBranch();
    this.store.setRef(`refs/heads/${currentBranch}`, targetCommitHash, 'branch');

    // Handle reset mode
    if (mode === 'hard') {
      // Clear staging area and removed files
      this.stagingArea.clear();
      this.removedFiles.clear();
      this._saveStagingArea();
    }
    // For soft reset, preserve staging area

    return { success: true };
  }

  /**
   * Merge a branch into the current branch
   * @param {string} branchName - Name of branch to merge
   * @returns {Object} - Merge result {type, conflicts?}
   */
  merge(branchName) {
    const { findMergeBase } = require('./objects');

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
      // Fast-forward to target
      this.store.setRef(`refs/heads/${currentBranch}`, targetHead, 'branch');
      return { type: 'fast-forward' };
    }

    // Find merge base
    const mergeBase = findMergeBase(currentHead, targetHead, this.store);


    // Handle case where branches have no common ancestor (imported branches)
    if (mergeBase === null) {
      // Treat as three-way merge with empty base (will likely cause conflicts)
      try {
        const mergeCommitHash = this._performThreeWayMerge(currentHead, targetHead, null);
        return { type: 'three-way', commitHash: mergeCommitHash, conflicts: [] };
      } catch (error) {
        if (error.conflicts) {
          return {
            type: 'conflict',
            conflicts: error.conflicts
          };
        } else {
          throw error;
        }
      }
    }

    // Check for fast-forward merge (current is ancestor of target)
    if (mergeBase === currentHead) {
      // Fast-forward: just move current branch to target
      this.store.setRef(`refs/heads/${currentBranch}`, targetHead, 'branch');
      return { type: 'fast-forward' };
    }

    // Check if target is ancestor of current (already up-to-date)
    if (mergeBase === targetHead) {
      return { type: 'up-to-date' };
    }

    // Three-way merge needed - full implementation with conflict detection
    try {
      const mergeCommitHash = this._performThreeWayMerge(currentHead, targetHead, mergeBase);
      return { type: 'three-way', commitHash: mergeCommitHash, conflicts: [] };
    } catch (error) {
      // Check if it's a merge conflict error
      if (error.conflicts) {
        return {
          type: 'conflict',
          conflicts: error.conflicts
        };
      } else {
        // Other error
        return {
          type: 'conflict',
          conflicts: [{ file: 'unknown', type: 'error', message: error.message }]
        };
      }
    }
  }

  /**
   * Perform three-way merge (simplified implementation)
   * @private
   */
  _performThreeWayMerge(currentHead, targetHead, mergeBase) {
    if (this.debugMode) {
      console.log(`🔍 Performing three-way merge: ${currentHead.substring(0, 8)} + ${targetHead.substring(0, 8)} (base: ${mergeBase ? mergeBase.substring(0, 8) : 'none'})`);
    }

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


    const mergedEntries = [];
    const conflicts = [];

    for (const fileName of allFileNames) {
      const baseEntry = baseFiles.get(fileName);
      const currentEntry = currentFiles.get(fileName);
      const targetEntry = targetFiles.get(fileName);


      if (this.debugMode) {
        console.log(`🔍 Merging file: ${fileName} (base:${baseEntry ? 'Y' : 'N'}, current:${currentEntry ? 'Y' : 'N'}, target:${targetEntry ? 'Y' : 'N'})`);
      }

      // Apply three-way merge logic
      if (!baseEntry && !currentEntry && targetEntry) {
        // File added in target only
        mergedEntries.push(targetEntry);
      } else if (!baseEntry && currentEntry && !targetEntry) {
        // File added in current only
        mergedEntries.push(currentEntry);
      } else if (!baseEntry && currentEntry && targetEntry) {
        // File added in both - check if identical
        if (currentEntry.hash === targetEntry.hash) {
          mergedEntries.push(currentEntry);
        } else {
          // Conflict: same file added with different content
          conflicts.push({
            file: fileName,
            type: 'both-added',
            message: `File added in both branches with different content`
          });
        }
      } else if (baseEntry && !currentEntry && !targetEntry) {
        // File deleted in both - remove it
        continue;
      } else if (baseEntry && !currentEntry && targetEntry) {
        // File deleted in current, modified in target
        if (baseEntry.hash === targetEntry.hash) {
          // File unchanged in target, deleted in current - delete it
          continue;
        } else {
          // Conflict: deleted in current, modified in target
          conflicts.push({
            file: fileName,
            type: 'deleted-modified',
            message: `File deleted in current branch but modified in target`
          });
        }
      } else if (baseEntry && currentEntry && !targetEntry) {
        // File modified in current, deleted in target
        if (baseEntry.hash === currentEntry.hash) {
          // File unchanged in current, deleted in target - delete it
          continue;
        } else {
          // Conflict: modified in current, deleted in target
          conflicts.push({
            file: fileName,
            type: 'modified-deleted',
            message: `File modified in current branch but deleted in target`
          });
        }
      } else if (baseEntry && currentEntry && targetEntry) {
        // File exists in all three
        if (currentEntry.hash === targetEntry.hash) {
          // Both branches have same content
          mergedEntries.push(currentEntry);
        } else if (baseEntry.hash === currentEntry.hash) {
          // File unchanged in current, modified in target
          mergedEntries.push(targetEntry);
        } else if (baseEntry.hash === targetEntry.hash) {
          // File unchanged in target, modified in current
          mergedEntries.push(currentEntry);
        } else {
          // File modified in both branches - conflict
          conflicts.push({
            file: fileName,
            type: 'both-modified',
            message: `File modified in both branches`
          });
        }
      }
    }

    // If there are conflicts, throw an error to trigger conflict handling
    if (conflicts.length > 0) {
      const error = new Error('Merge conflicts detected');
      error.conflicts = conflicts;
      throw error;
    }
    if (this.debugMode) {
      console.log(`🔍 Merge successful: ${mergedEntries.length} files in result`);
    }

    // Create merged tree
    const mergedTreeHash = storeTree(mergedEntries, this.store);

    // Create merge commit
    const mergeMessage = `Merge branch into ${this.getCurrentBranch()}`;
    const mergeCommitHash = createCommit(
      mergedTreeHash,
      mergeMessage,
      this.authorName || 'Unknown',
      this.authorEmail || 'unknown@example.com',
      currentHead,
      this.store
    );

    // Update current branch to point to merge commit
    const currentBranch = this.getCurrentBranch();
    this.store.setRef(`refs/heads/${currentBranch}`, mergeCommitHash, 'branch');

    return mergeCommitHash;
  }

  /**
   * Close repository
   */
  close() {
    this.store.close();
  }
}

module.exports = {
  ContentAddressedRepo
};