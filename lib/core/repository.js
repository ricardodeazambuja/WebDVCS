/**
 * Repository - Core VCS operations
 * Handles commit, checkout, merge, reset, and diff operations
 */

const { storeFile, getFile } = require('./file-storage');
const { storeTree, getTree, createCommit, getCommit, getCommitHistory } = require('./objects');
const { diffFiles } = require('./diff');
const { areFilesEqual, generateAddDiff, generateModifyDiff, generateDeleteDiff } = require('./repo-utils');
const { createLogger } = require('./logger');

class Repository {
  constructor(config) {
    // Extract configuration with validation
    if (!config || !config.store) {
      throw new Error('Repository requires a configuration object with store');
    }

    this.store = config.store;
    this.stagingArea = config.stagingArea;
    this.removedFiles = config.removedFiles;
    this.fileManager = config.fileManager;
    this.stagingManager = config.stagingManager;
    this.branchManager = config.branchManager;
    this.getCurrentCommit = config.getCurrentCommit;
    this.setCurrentCommit = config.setCurrentCommit;
    this.getHeadFileMetadata = config.getHeadFileMetadata;
    this.resolveCommitReference = config.resolveCommitReference;

    // Initialize logger for repository operations
    this.logger = createLogger('repository');
  }

  /**
   * Core VCS commit operation
   */
  commit(message, author = null, email = null, options = {}) {
    this.validateCommitParams(message, author, email);
    const { resolvedAuthor, resolvedEmail } = this.resolveCommitIdentity(author, email);

    if (options && options.debug) {
      this.logger.info(`Starting commit by ${resolvedAuthor}`, { stagedFiles: this.stagingArea.size });
    }

    const commitContext = this.prepareCommitContext();
    const treeData = this.buildCommitTree(commitContext, options);

    this.validateTreeChanges(treeData.treeHash, commitContext.currentHead);

    if (options && options.debug) {
      this.logger.debug(`Creating commit object`);
    }

    const commitHash = createCommit(treeData.treeHash, message, resolvedAuthor, resolvedEmail, commitContext.currentHead || null, this.store);

    this.finalizeCommit(commitContext.currentBranch, commitHash, options);

    return {
      commitHash,
      branch: commitContext.currentBranch,
      treeHash: treeData.treeHash,
      files: treeData.fileResults,
      author: resolvedAuthor,
      message
    };
  }

  /**
   * Validate commit parameters
   */
  validateCommitParams(message, author, email) {
    if (this.stagingArea.size === 0 && this.removedFiles.size === 0) {
      throw new Error('Nothing to commit - no files staged and no files removed');
    }
  }

  /**
   * Resolve author and email for commit
   */
  resolveCommitIdentity(author, email) {
    let resolvedAuthor = author;
    let resolvedEmail = email;

    if (!resolvedAuthor) {
      resolvedAuthor = this.store.getMeta('author.name');
      if (!resolvedAuthor) {
        throw new Error('Author is required. Set with: repo.setAuthor(name, email) or pass as parameter');
      }
    }

    if (!resolvedEmail) {
      resolvedEmail = this.store.getMeta('author.email') || null;
    }

    return { resolvedAuthor, resolvedEmail };
  }

  /**
   * Prepare commit context information
   */
  prepareCommitContext() {
    const currentBranch = this.branchManager.getCurrentBranch();
    const currentHead = this.store.getBranchHead(currentBranch);
    const headFileMetadata = this.getHeadFileMetadata();

    return {
      currentBranch,
      currentHead,
      headFileMetadata
    };
  }

  /**
   * Build tree from staged files and HEAD files
   */
  buildCommitTree(commitContext, options = {}) {
    const entries = [];
    const fileResults = [];
    const processedFiles = new Set();

    if (options && options.debug && commitContext.headFileMetadata.size > 0) {
      this.logger.debug(`Found existing files in HEAD commit`, { fileCount: commitContext.headFileMetadata.size });
    }

    // Process staged files
    this.processStagedFiles(entries, fileResults, processedFiles, options);

    // Add existing files from HEAD
    this.addHeadFiles(entries, commitContext.headFileMetadata, processedFiles, options);

    if (options && options.debug) {
      this.logger.debug(`Creating commit tree`, {
        totalEntries: entries.length,
        stagedFiles: this.stagingArea.size,
        existingFiles: entries.length - this.stagingArea.size
      });
    }

    const treeHash = storeTree(entries, this.store);

    return { treeHash, fileResults };
  }

  /**
   * Process staged files for commit tree
   */
  processStagedFiles(entries, fileResults, processedFiles, options) {
    for (const [fileName, stagedInfo] of this.stagingArea) {
      if (options && options.debug) {
        this.logger.debug(`Processing staged file: ${fileName}`, {
          size: stagedInfo.size,
          hash: stagedInfo.hash ? stagedInfo.hash.substring(0, 8) : 'null'
        });
      }

      // File is already stored via pure delta system - reuse hash without re-storage!
      const storeResult = {
        hash: stagedInfo.hash,
        totalSize: stagedInfo.size,
        fileName: fileName
      };

      if (options && options.debug) {
        this.logger.debug(`Reusing hash for ${fileName}`, { hash: storeResult.hash ? storeResult.hash.substring(0, 8) : 'null' });
      }

      const binary = stagedInfo.binary || false;

      entries.push({
        name: fileName,
        type: stagedInfo.type || 'file',
        hash: storeResult.hash,
        binary: binary,
        mode: stagedInfo.mode || 0o644,
        mtime: stagedInfo.mtime || Math.floor(Date.now() / 1000),
        size: stagedInfo.size || 0,
        target: stagedInfo.target || null
      });

      fileResults.push({
        fileName,
        binary,
        size: storeResult.totalSize
      });

      processedFiles.add(fileName);
    }
  }

  /**
   * Add existing HEAD files to commit tree
   */
  addHeadFiles(entries, headFileMetadata, processedFiles, options) {
    for (const [fileName, metadata] of headFileMetadata) {
      if (!processedFiles.has(fileName) && !this.removedFiles.has(fileName)) {
        if (options && options.debug) {
          this.logger.debug(`Including existing file from HEAD: ${fileName}`);
        }

        entries.push({
          name: fileName,
          type: metadata.type || 'file',
          hash: metadata.hash,
          binary: metadata.binary,
          mode: metadata.mode || 0o644,
          mtime: metadata.mtime || Math.floor(Date.now() / 1000),
          size: metadata.size || 0,
          target: metadata.target || null
        });
      }
    }
  }

  /**
   * Validate that tree has changes from HEAD
   */
  validateTreeChanges(treeHash, currentHead) {
    if (currentHead) {
      const currentCommit = getCommit(currentHead, this.store);
      if (currentCommit.tree === treeHash) {
        this.clearStagingAfterNoChanges();
        throw new Error('No changes to commit - staged files and removals match HEAD commit');
      }
    }
  }

  /**
   * Clear staging area when no changes detected
   */
  clearStagingAfterNoChanges() {
    this.stagingArea.clear();
    this.removedFiles.clear();
    this.store.setMeta('file_metadata', {});
    this.stagingManager.saveStagingArea();
    this.stagingManager.saveRemovedFiles();
  }

  /**
   * Finalize commit with atomic operations
   */
  finalizeCommit(currentBranch, commitHash, options) {
    if (options && options.debug) {
      this.logger.debug(`Updating branch HEAD and cleaning up`, { branch: currentBranch, commit: commitHash.substring(0, 8) });
    }

    // Atomic post-commit operations
    this.store.transaction(() => {
      // Update branch HEAD
      this.store.updateBranchHead(currentBranch, commitHash);

      // Set current commit so files are accessible after commit
      this.setCurrentCommit(commitHash);
      this.store.setMeta('current_commit', commitHash);

      // Clear staging area and removed files after successful commit (Git-like behavior)
      this.stagingArea.clear();
      this.removedFiles.clear();
      this.store.setMeta('file_metadata', {});
      this.stagingManager.saveStagingArea();
      this.stagingManager.saveRemovedFiles();
    });
  }

  /**
   * Diff two files
   */
  diffFiles(fileNameA, fileNameB) {
    const fileA = this.fileManager.getFile(fileNameA);
    const fileB = this.fileManager.getFile(fileNameB);

    if (!fileA) throw new Error(`File not found: ${fileNameA}`);
    if (!fileB) throw new Error(`File not found: ${fileNameB}`);

    return diffFiles(fileA, fileB, fileNameA, fileNameB);
  }

  /**
   * Diff two commits
   */
  diffCommits(commitHashA, commitHashB) {
    const commitA = getCommit(commitHashA, this.store);
    const commitB = getCommit(commitHashB, this.store);
    const treeA = getTree(commitA.tree, this.store);
    const treeB = getTree(commitB.tree, this.store);

    // Create file maps for easy comparison
    const filesA = new Map();
    const filesB = new Map();

    treeA.forEach(entry => {
      if (entry.type === 'file') {
        filesA.set(entry.name, entry);
      }
    });

    treeB.forEach(entry => {
      if (entry.type === 'file') {
        filesB.set(entry.name, entry);
      }
    });

    // Find all unique file names
    const allFiles = new Set([...filesA.keys(), ...filesB.keys()]);
    const results = [];

    for (const fileName of allFiles) {
      const entryA = filesA.get(fileName);
      const entryB = filesB.get(fileName);

      if (!entryA) {
        // File added
        results.push({
          file: fileName,
          type: 'added',
          diff: `New file: ${fileName}`
        });
      } else if (!entryB) {
        // File removed
        results.push({
          file: fileName,
          type: 'removed',
          diff: `Deleted file: ${fileName}`
        });
      } else if (entryA.hash !== entryB.hash) {
        // File modified
        const fileDataA = getFile(entryA.hash, this.store);
        const fileDataB = getFile(entryB.hash, this.store);
        const diff = diffFiles(fileDataA, fileDataB, fileName, fileName);

        results.push({
          file: fileName,
          type: 'modified',
          diff: diff.content || diff
        });
      }
    }

    return results;
  }

  /**
   * Checkout a commit
   */
  checkout(commitHash, fileName = null, writeToDisk = false) {
    // Resolve commit reference (handles HEAD, HEAD~N, etc.)
    const resolvedCommitHash = this.resolveCommitReference(commitHash);
    if (!resolvedCommitHash) {
      throw new Error(`Invalid commit reference: ${commitHash}`);
    }

    if (fileName) {
      // Single file checkout
      return this.checkoutFile(resolvedCommitHash, fileName, writeToDisk);
    }

    // Full commit checkout
    const commit = getCommit(resolvedCommitHash, this.store);
    const tree = getTree(commit.tree, this.store);

    // Set current commit but don't touch staging area
    this.setCurrentCommit(resolvedCommitHash);
    this.store.setMeta('current_commit', resolvedCommitHash);

    // Collect files and metadata for export
    const files = {};
    const filesMetadata = {};
    for (const entry of tree) {
      if (entry.type === 'file') {
        const fileContent = getFile(entry.hash, this.store);
        files[entry.name] = fileContent;
        filesMetadata[entry.name] = {
          type: entry.type,
          mode: entry.mode,
          mtime: entry.mtime,
          size: entry.size,
          binary: entry.binary
        };
      } else if (entry.type === 'archive') {
        // Archive files need special handling - use FileManager for reconstruction
        let fileContent;
        if (entry.hash) {
          // Original archive preserved
          fileContent = getFile(entry.hash, this.store);
        } else {
          // Need to reconstruct from internal files - use FileManager
          try {
            fileContent = this.fileManager._reconstructArchiveFromCommit(entry.name, commitHash, entry);
          } catch (error) {
            // Fallback to empty content if reconstruction fails
            fileContent = new Uint8Array(0);
          }
        }
        files[entry.name] = fileContent;
        filesMetadata[entry.name] = {
          type: entry.type,
          mode: entry.mode,
          mtime: entry.mtime,
          size: entry.size,
          binary: entry.binary
        };
      } else if (entry.type === 'symlink') {
        // Symlinks have no content, just metadata
        filesMetadata[entry.name] = {
          type: 'symlink',
          mode: entry.mode,
          mtime: entry.mtime,
          size: 0,
          target: entry.target,
          binary: false
        };
      }
    }

    return {
      commitHash: resolvedCommitHash,
      fileCount: Object.keys(files).length + Object.keys(filesMetadata).filter(name => filesMetadata[name].type === 'symlink').length,
      files,
      filesMetadata,
      writeToDisk
    };
  }

  /**
   * Checkout a single file from commit
   */
  checkoutFile(commitHash, fileName, writeToDisk = false) {
    // Resolve commit reference (handles HEAD, HEAD~N, etc.)
    const resolvedCommitHash = this.resolveCommitReference(commitHash);
    if (!resolvedCommitHash) {
      throw new Error(`Invalid commit reference: ${commitHash}`);
    }

    const commit = getCommit(resolvedCommitHash, this.store);
    const tree = getTree(commit.tree, this.store);

    for (const entry of tree) {
      if ((entry.type === 'file' || entry.type === 'symlink') && entry.name === fileName) {
        let fileContent = null;
        if (entry.type === 'file') {
          fileContent = getFile(entry.hash, this.store);
        }

        return {
          commitHash: resolvedCommitHash,
          fileName: entry.name,
          content: fileContent, // null for symlinks
          size: entry.type === 'file' ? fileContent.length : 0,
          metadata: {
            type: entry.type,
            mode: entry.mode,
            mtime: entry.mtime,
            size: entry.size,
            target: entry.target,
            binary: entry.binary
          },
          writeToDisk
        };
      }
    }

    throw new Error(`File '${fileName}' not found in commit ${resolvedCommitHash}`);
  }

  /**
   * Get commit history
   */
  log(maxCount = 10) {
    const currentBranch = this.branchManager.getCurrentBranch();
    const headCommit = this.store.getBranchHead(currentBranch);

    if (!headCommit) {
      return [];
    }

    return getCommitHistory(headCommit, maxCount, this.store);
  }

  /**
   * Reset HEAD to specific commit
   */
  reset(commitRef, options = {}) {
    const mode = options.mode || 'soft'; // 'soft' or 'hard'

    if (!['soft', 'hard'].includes(mode)) {
      throw new Error(`Invalid reset mode: ${mode}. Use 'soft' or 'hard'`);
    }

    // Resolve commit reference (handle HEAD~N notation)
    const targetCommitHash = this.resolveCommitReference(commitRef);

    if (!targetCommitHash) {
      throw new Error(`Invalid commit reference: ${commitRef}`);
    }

    // Verify commit exists
    try {
      const commit = getCommit(targetCommitHash, this.store);
    } catch (error) {
      throw new Error(`Commit not found: ${targetCommitHash}`);
    }

    const currentBranch = this.branchManager.getCurrentBranch();
    const currentHead = this.store.getBranchHead(currentBranch);

    // Atomic reset operation
    this.store.transaction(() => {
      // Update branch HEAD
      this.store.updateBranchHead(currentBranch, targetCommitHash);

      if (mode === 'hard') {
        // Hard reset: clear staging area and removed files, set current commit
        this.stagingArea.clear();
        this.removedFiles.clear();
        this.setCurrentCommit(targetCommitHash);
        this.stagingManager.saveStagingArea();
        this.stagingManager.saveRemovedFiles();
        this.store.setMeta('current_commit', targetCommitHash);
      } else {
        // Soft reset: keep staging area as is, just move HEAD
        // For soft reset, we don't change staging area or removed files
      }
    });

    return {
      success: true,
      mode: mode,
      from: currentHead,
      to: targetCommitHash,
      branch: currentBranch
    };
  }

  /**
   * Merge branches
   */
  merge(sourceBranchName) {
    const currentBranch = this.branchManager.getCurrentBranch();

    // Cannot merge branch into itself
    if (sourceBranchName === currentBranch) {
      return { type: 'up-to-date', message: `Already up-to-date with ${sourceBranchName}` };
    }

    // Get commit hashes
    const currentHead = this.store.getBranchHead(currentBranch);
    const sourceHead = this.store.getBranchHead(sourceBranchName);

    if (!sourceHead) {
      throw new Error(`Branch '${sourceBranchName}' does not exist`);
    }

    if (!currentHead) {
      // Current branch is empty, can fast-forward to source
      this.store.updateBranchHead(currentBranch, sourceHead);
      this.checkout(sourceHead, null, false);
      return {
        type: 'fast-forward',
        message: `Fast-forwarded ${currentBranch} to ${sourceBranchName}`,
        commitHash: sourceHead
      };
    }

    // Check if already up-to-date
    if (currentHead === sourceHead) {
      return { type: 'up-to-date', message: `Already up-to-date with ${sourceBranchName}` };
    }

    // Find merge base (common ancestor)
    const mergeBase = this.findMergeBase(currentHead, sourceHead);

    if (!mergeBase) {
      throw new Error(`No common ancestor found between ${currentBranch} and ${sourceBranchName}`);
    }

    // Check if we can do fast-forward merge
    if (mergeBase === currentHead) {
      // Source branch is ahead, can fast-forward
      this.store.updateBranchHead(currentBranch, sourceHead);
      this.checkout(sourceHead, null, false);
      return {
        type: 'fast-forward',
        message: `Fast-forwarded ${currentBranch} to ${sourceBranchName}`,
        commitHash: sourceHead
      };
    }

    if (mergeBase === sourceHead) {
      // Current branch is ahead, already up-to-date
      return { type: 'up-to-date', message: `Already up-to-date with ${sourceBranchName}` };
    }

    // Need three-way merge
    return this.performThreeWayMerge(currentBranch, sourceBranchName, currentHead, sourceHead, mergeBase);
  }

  /**
   * Find common ancestor
   */
  findMergeBase(commit1Hash, commit2Hash) {
    const ancestors1 = this.getAncestors(commit1Hash);
    const ancestors2 = this.getAncestors(commit2Hash);

    // Find first common ancestor
    for (const ancestor1 of ancestors1) {
      if (ancestors2.includes(ancestor1)) {
        return ancestor1;
      }
    }

    return null; // No common ancestor
  }

  /**
   * Get all ancestors
   */
  getAncestors(commitHash) {
    const ancestors = [];
    const visited = new Set();
    const queue = [commitHash];

    while (queue.length > 0) {
      const current = queue.shift();

      if (visited.has(current)) continue;
      visited.add(current);
      ancestors.push(current);

      try {
        const commit = getCommit(current, this.store);

        // Handle merge commits with multiple parents
        if (commit.parents && Array.isArray(commit.parents)) {
          // Merge commit - add all parents
          for (const parent of commit.parents) {
            if (parent && !visited.has(parent)) {
              queue.push(parent);
            }
          }
        } else if (commit.parent) {
          // Regular commit - add single parent
          queue.push(commit.parent);
        }
      } catch (error) {
        // Invalid commit, skip
        continue;
      }
    }

    return ancestors;
  }


  /**
   * Perform three-way merge
   */
  performThreeWayMerge(currentBranch, sourceBranch, currentHead, sourceHead, mergeBase) {
    try {
      const trees = this.prepareMergeTrees(mergeBase, currentHead, sourceHead);
      const mergeResult = this.analyzeThreeWayMerge(trees.baseTree, trees.currentTree, trees.sourceTree);

      if (mergeResult.conflicts.length > 0) {
        return this.createConflictResult(mergeResult.conflicts);
      }

      this.applyMergeResult(mergeResult);
      const mergeCommitHash = this.createMergeCommit(
        `Merge branch '${sourceBranch}' into ${currentBranch}`,
        'System',
        currentHead,
        sourceHead
      );

      this.finalizeMerge(currentBranch, mergeCommitHash);

      return {
        type: 'three-way',
        commitHash: mergeCommitHash,
        message: `Merged branch '${sourceBranch}' into ${currentBranch}`,
        conflicts: []
      };

    } catch (error) {
      throw new Error(`Merge failed: ${error.message}`);
    }
  }

  /**
   * Prepare file trees for three-way merge
   */
  prepareMergeTrees(mergeBase, currentHead, sourceHead) {
    return {
      baseTree: this.getCommitFiles(mergeBase),
      currentTree: this.getCommitFiles(currentHead),
      sourceTree: this.getCommitFiles(sourceHead)
    };
  }

  /**
   * Create conflict result object
   */
  createConflictResult(conflicts) {
    return {
      type: 'conflict',
      conflicts: conflicts,
      message: `Merge conflict in ${conflicts.length} file(s)`
    };
  }

  /**
   * Apply merge result to staging area
   */
  applyMergeResult(mergeResult) {
    // Clear staging area and apply merge result
    this.stagingArea.clear();
    this.removedFiles.clear();

    // Add all merged files to staging area
    for (const [fileName, fileData] of Object.entries(mergeResult.files)) {
      this.addMergedFileToStaging(fileName, fileData);
    }
  }

  /**
   * Add a merged file to staging area
   */
  addMergedFileToStaging(fileName, fileData) {
    // Use pure delta system for ALL files - consistent with _addFileInternal
    const storeResult = storeFile(fileData, fileName, this.store);

    // Create default metadata for merged files
    const mergedMetadata = {
      mode: 0o644,
      mtime: Math.floor(Date.now() / 1000),
      size: fileData.length,
      type: 'file',
      target: null
    };

    // Add to staging area with metadata
    this.stagingArea.set(fileName, {
      hash: storeResult.hash,
      fileName: fileName,
      size: mergedMetadata.size,
      binary: false, // Merge results are typically text
      mode: mergedMetadata.mode,
      mtime: mergedMetadata.mtime,
      type: mergedMetadata.type,
      target: mergedMetadata.target
    });
  }

  /**
   * Finalize merge by updating branch and cleaning up
   */
  finalizeMerge(currentBranch, mergeCommitHash) {
    // Update branch HEAD
    this.store.updateBranchHead(currentBranch, mergeCommitHash);

    // Clear staging area after merge commit
    this.stagingArea.clear();
    this.removedFiles.clear();
    this.stagingManager.saveStagingArea();
    this.stagingManager.saveRemovedFiles();
  }

  /**
   * Get all files from a commit as Map
   */
  getCommitFiles(commitHash) {

    const commit = getCommit(commitHash, this.store);
    const tree = getTree(commit.tree, this.store);
    const files = new Map();

    for (const entry of tree) {
      if (entry.type === 'file') {
        const fileContent = getFile(entry.hash, this.store);
        files.set(entry.name, fileContent);
      }
    }

    return files;
  }

  /**
   * Analyze three-way merge and detect conflicts
   */
  analyzeThreeWayMerge(baseTree, currentTree, sourceTree) {
    const result = { files: {}, conflicts: [] };

    // Get all unique file names
    const allFiles = new Set([
      ...baseTree.keys(),
      ...currentTree.keys(),
      ...sourceTree.keys()
    ]);

    for (const fileName of allFiles) {
      const baseFile = baseTree.get(fileName);
      const currentFile = currentTree.get(fileName);
      const sourceFile = sourceTree.get(fileName);

      // Analyze file state
      const fileResult = this.analyzeFileChange(fileName, baseFile, currentFile, sourceFile);

      if (fileResult.conflict) {
        result.conflicts.push(fileResult);
      } else if (fileResult.content) {
        result.files[fileName] = fileResult.content;
      }
    }

    return result;
  }

  /**
   * Analyze changes to a single file in three-way merge
   */
  analyzeFileChange(fileName, baseFile, currentFile, sourceFile) {

    const baseExists = !!baseFile;
    const currentExists = !!currentFile;
    const sourceExists = !!sourceFile;

    // File added in both branches with different content
    if (!baseExists && currentExists && sourceExists) {
      if (!areFilesEqual(currentFile, sourceFile)) {
        return {
          file: fileName,
          conflict: true,
          type: 'both-added',
          message: `Both branches added '${fileName}' with different content`
        };
      } else {
        // Same content added in both - no conflict
        return { file: fileName, content: currentFile };
      }
    }

    // File deleted in both branches
    if (baseExists && !currentExists && !sourceExists) {
      // Both deleted - no conflict, file remains deleted
      return { file: fileName, content: null };
    }

    // File modified in both branches
    if (baseExists && currentExists && sourceExists) {
      const currentChanged = !areFilesEqual(baseFile, currentFile);
      const sourceChanged = !areFilesEqual(baseFile, sourceFile);

      if (currentChanged && sourceChanged) {
        // Both modified - check if same result
        if (areFilesEqual(currentFile, sourceFile)) {
          // Same modification - no conflict
          return { file: fileName, content: currentFile };
        } else {
          // Different modifications - conflict
          return {
            file: fileName,
            conflict: true,
            type: 'both-modified',
            message: `'${fileName}' modified differently in both branches`
          };
        }
      } else if (currentChanged) {
        // Only current branch modified
        return { file: fileName, content: currentFile };
      } else if (sourceChanged) {
        // Only source branch modified
        return { file: fileName, content: sourceFile };
      } else {
        // Neither modified
        return { file: fileName, content: baseFile };
      }
    }

    // File deleted in one branch, modified in other
    if (baseExists && !currentExists && sourceExists) {
      if (!areFilesEqual(baseFile, sourceFile)) {
        return {
          file: fileName,
          conflict: true,
          type: 'deleted-modified',
          message: `'${fileName}' deleted in current branch but modified in source branch`
        };
      } else {
        // File unchanged in source, deleted in current - keep deleted
        return { file: fileName, content: null };
      }
    }

    if (baseExists && currentExists && !sourceExists) {
      if (!areFilesEqual(baseFile, currentFile)) {
        return {
          file: fileName,
          conflict: true,
          type: 'modified-deleted',
          message: `'${fileName}' modified in current branch but deleted in source branch`
        };
      } else {
        // File unchanged in current, deleted in source - delete it
        return { file: fileName, content: null };
      }
    }

    // File added in only one branch
    if (!baseExists && currentExists && !sourceExists) {
      return { file: fileName, content: currentFile };
    }

    if (!baseExists && !currentExists && sourceExists) {
      return { file: fileName, content: sourceFile };
    }

    // Default case - should not happen
    return { file: fileName, content: currentFile || sourceFile || baseFile };
  }

  /**
   * Create merge commit with two parents
   */
  createMergeCommit(message, author, parent1, parent2) {

    // Create the tree from current staging area + removed files logic (same as regular commit)
    const fileMetadata = this.store.getMeta('file_metadata') || {};

    // Get existing files from HEAD commit (metadata only - no content duplication)
    const headFileMetadata = this.getHeadFileMetadata();

    // Create tree from staged files only (merge already resolved conflicts into staging area)
    const entries = [];

    // Process staged files
    for (const [fileName, stagedInfo] of this.stagingArea) {
      // File is already stored via pure delta system - reuse hash without re-storage!
      const storeResult = {
        hash: stagedInfo.hash,
        totalSize: stagedInfo.size,
        fileName: fileName
      };

      entries.push({
        name: fileName,
        type: stagedInfo.type || 'file',
        hash: storeResult.hash,
        binary: stagedInfo.binary,
        // Add metadata fields from staging area with defensive fallbacks
        mode: stagedInfo.mode || 0o644,
        mtime: stagedInfo.mtime || Math.floor(Date.now() / 1000),
        size: stagedInfo.size || 0,
        target: stagedInfo.target || null
      });
    }

    const treeHash = storeTree(entries, this.store);

    // Use existing createCommit function but with multiple parents
    // Need to modify createCommit to support multiple parents
    return this.createCommitWithParents(treeHash, message, author, [parent1, parent2]);
  }

  /**
   * Create commit with multiple parents
   */
  createCommitWithParents(treeHash, message, author, parents) {
    const timestamp = Math.floor(Date.now() / 1000);

    // Use transaction for atomicity
    const commitHash = this.store.transaction(() => {
      // Create unique blob as commit marker (using timestamp for uniqueness)
      const commitMarker = new TextEncoder().encode(`commit-${timestamp}-${Math.random()}`);
      // Use first parent as base for delta compression
      const baseHash = parents && parents.length > 0 ? parents[0] : null;
      const result = this.store.storeBlobWithDelta(commitMarker, baseHash);
      const commitRid = result.rid;
      const commitHash = result.hash;

      // Convert tree hash to RID
      const treeRid = this.store.getRidFromHash(treeHash);
      if (!treeRid) {
        throw new Error(`Tree not found for hash: ${treeHash}`);
      }

      // Use first parent only (manifests table supports single parent)
      let parentRid = null;
      if (parents && parents.length > 0 && parents[0]) {
        parentRid = this.store.getRidFromHash(parents[0]);
        if (!parentRid) {
          throw new Error(`Parent commit not found for hash: ${parents[0]}`);
        }
      }

      // Insert into manifests table (rid, tree_rid, parent_rid, message, author, email, timestamp)
      this.store.insertManifest.run(commitRid, treeRid, parentRid, message, author, this.store.getMeta('author.email'), timestamp);

      return commitHash;
    });

    return commitHash;
  }

  /**
   * Show staged changes compared to HEAD commit
   */
  showChanges() {
    const changes = [];
    const headFiles = this.getHeadFiles();

    // Check staged files vs HEAD
    this.addStagedFileChanges(changes, headFiles);

    // Check for removed files
    this.addRemovedFileChanges(changes, headFiles);

    return changes;
  }

  /**
   * Get HEAD commit files safely
   */
  getHeadFiles() {
    const currentBranch = this.branchManager.getCurrentBranch();
    const currentHead = this.store.getBranchHead(currentBranch);

    if (!currentHead) {
      return new Map();
    }

    try {
      return this.getCommitFiles(currentHead);
    } catch (error) {
      // If HEAD commit is invalid, treat as empty
      return new Map();
    }
  }

  /**
   * Add staged file changes to changes array
   */
  addStagedFileChanges(changes, headFiles) {
    for (const [fileName, stagedInfo] of this.stagingArea) {
      // Get actual staged content from chunking system
      const stagedContent = getFile(stagedInfo.hash, this.store);
      const headContent = headFiles.get(fileName);

      if (!headContent) {
        // File is new (added)
        changes.push({
          file: fileName,
          type: 'added',
          diff: generateAddDiff(fileName, stagedContent)
        });
      } else if (!this.areFilesEqual(stagedContent, headContent)) {
        // File is modified
        changes.push({
          file: fileName,
          type: 'modified',
          diff: generateModifyDiff(fileName, headContent, stagedContent)
        });
      }
      // If files are equal, no change to report
    }
  }

  /**
   * Add removed file changes to changes array
   */
  addRemovedFileChanges(changes, headFiles) {
    for (const fileName of this.removedFiles) {
      const headContent = headFiles.get(fileName);
      if (headContent) {
        changes.push({
          file: fileName,
          type: 'deleted',
          diff: generateDeleteDiff(fileName, headContent)
        });
      }
    }
  }

  /**
   * Compare two files for equality (helper for showChanges)
   */
  areFilesEqual(file1, file2) {
    return areFilesEqual(file1, file2);
  }
}

module.exports = Repository;