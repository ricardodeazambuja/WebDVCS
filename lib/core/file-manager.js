
const { getFile } = require('./file-storage');
const { getCommit, getTree, getTreeFiles } = require('./objects');
const { stringToUint8Array } = require('./utils');
let simpleArchive;
try {
  simpleArchive = require('./simple-archive');
} catch (error) {
  simpleArchive = null;
}

function isArchiveMetadata(entry) {
  return entry && entry.type === 'archive';
}

class FileManager {
  constructor(config) {
    if (!config?.store) {
      throw new Error('FileManager requires store');
    }

    this.store = config.store;
    this.stagingArea = config.stagingArea;
    this.removedFiles = config.removedFiles;
    this.saveStagingArea = config.saveStagingArea;
    this.saveRemovedFiles = config.saveRemovedFiles;
    this.getHeadFileMetadata = config.getHeadFileMetadata;
    this.getCurrentBranch = config.getCurrentBranch;
    this.getFileSizeFromHash = config.getFileSizeFromHash;
    this.getCurrentCommit = config.getCurrentCommit;
    this.debugMode = false;
  }

  /**
   * Get file content from staging area or commit
   */
  getFile(fileName) {
    // Check if file is staged for removal first
    if (this.removedFiles.has(fileName)) {
      return null;
    }

    // Check staging area next (for staged changes)
    if (this.stagingArea.has(fileName)) {
      const stagedInfo = this.stagingArea.get(fileName);

      // Check if this is an archive file that needs reconstruction
      if (isArchiveMetadata(stagedInfo)) {
        return this._reconstructArchiveFromStaging(fileName, stagedInfo);
      }

      return getFile(stagedInfo.hash, this.store);
    }

    // Check current commit if available
    const currentCommit = this.getCurrentCommit();
    if (currentCommit) {
      return this.cat(fileName, currentCommit);
    }

    return null;
  }

  /**
   * View file content from staging or specific commit
   */
  cat(fileName, commitHash = null) {
    if (!commitHash) {
      // No commit specified, check staging area first then current commit
      if (this.stagingArea.has(fileName)) {
        const stagedInfo = this.stagingArea.get(fileName);

        // Check if this is an archive file that needs reconstruction
        if (isArchiveMetadata(stagedInfo)) {
          return this._reconstructArchiveFromStaging(fileName, stagedInfo);
        }

        return this.store.getBlob(stagedInfo.hash);
      }

      const currentCommit = this.getCurrentCommit();
      if (currentCommit) {
        return this.cat(fileName, currentCommit);
      }

      return null;
    }

    // Get from specific commit
    try {
      const commit = getCommit(commitHash, this.store);
      const tree = getTree(commit.tree, this.store);

      for (const entry of tree) {
        if (entry.type === 'file' && entry.name === fileName) {
          // Check if this is an archive in commit that needs reconstruction
          if (isArchiveMetadata(entry)) {
            return this._reconstructArchiveFromCommit(fileName, commitHash, entry);
          }

          return getFile(entry.hash, this.store);
        }
      }

      return null;
    } catch (error) {
      // Invalid commit
      return null;
    }
  }

  /**
   * Remove file from staging area
   */
  removeFile(fileName) {
    const removed = this.stagingArea.delete(fileName);

    // Remove from file metadata
    const fileMetadata = this.store.getMeta('file_metadata') || {};
    delete fileMetadata[fileName];
    this.store.setMeta('file_metadata', fileMetadata);

    this.saveStagingArea();
    return removed;
  }

  /**
   * Mark files for removal
   */
  rm(fileNames) {
    // Handle both single file and array of files
    const filesToRemove = Array.isArray(fileNames) ? fileNames : [fileNames];
    const results = { removed: 0, notFound: [], alreadyRemoved: [] };

    // Get current HEAD commit metadata to check if files exist
    const headFileMetadata = this.getHeadFileMetadata();

    for (const fileName of filesToRemove) {
      // Check if already marked for removal
      if (this.removedFiles.has(fileName)) {
        results.alreadyRemoved.push(fileName);
        continue;
      }

      // Check if file exists in staging area or HEAD commit
      const stagedFile = this.stagingArea.has(fileName);
      const committedFile = headFileMetadata.has(fileName);

      if (!stagedFile && !committedFile) {
        results.notFound.push(fileName);
        continue;
      }

      // Mark for removal
      this.removedFiles.add(fileName);
      results.removed++;

      // Remove from staging area if present
      if (stagedFile) {
        this.stagingArea.delete(fileName);

        // Remove from file metadata
        const fileMetadata = this.store.getMeta('file_metadata') || {};
        delete fileMetadata[fileName];
        this.store.setMeta('file_metadata', fileMetadata);
      }
    }

    // Save state
    this.saveStagingArea();
    this.saveRemovedFiles();

    // Return simple boolean for single file, detailed results for multiple files
    if (!Array.isArray(fileNames)) {
      return results.removed > 0;
    }

    return results;
  }

  /**
   * Unstage file or cancel removal
   */
  unstage(fileName) {
    // Check if file is staged for removal
    if (this.removedFiles.has(fileName)) {
      // Cancel the file removal
      this.removedFiles.delete(fileName);
      this.saveRemovedFiles();
      return { action: 'unremoved', file: fileName };
    }

    // Check if file is in staging area
    if (this.stagingArea.has(fileName)) {
      // Remove from staging area (existing removeFile behavior)
      return this.removeFile(fileName) ?
        { action: 'unstaged', file: fileName } :
        { action: 'failed', file: fileName };
    }

    // File not found in either staging or removal list
    return { action: 'not_found', file: fileName };
  }

  /**
   * List files from staging or current commit
   */
  listFiles() {
    // Return staged files if any exist
    if (this.stagingArea.size > 0) {
      return Array.from(this.stagingArea.keys()).sort();
    }

    // Otherwise return files from current commit
    const currentCommit = this.getCurrentCommit();
    if (currentCommit) {
      return this.listCommitFiles(currentCommit);
    }

    return [];
  }

  /**
   * List files from specific commit
   */
  listCommitFiles(commitHash) {
    if (!commitHash) {
      // No commit specified, use current behavior
      if (this.stagingArea.size > 0) {
        return Array.from(this.stagingArea.keys()).sort();
      }
      return [];
    }

    try {
      const commit = getCommit(commitHash, this.store);
      const tree = getTree(commit.tree, this.store);
      const files = [];

      for (const entry of tree) {
        if (entry.type === 'file') {
          files.push(entry.name);
        }
      }

      return files.sort();
    } catch (error) {
      // Invalid commit, return empty
      return [];
    }
  }

  /**
   * List repository files with metadata
   */
  listRepoFiles(dirPath = '', options = {}) {
    const currentBranch = this.getCurrentBranch();
    const headCommit = this.store.getBranchHead(currentBranch);

    if (!headCommit) {
      return { files: [], directories: [], metadata: { hasCommits: false } };
    }

    const commit = getCommit(headCommit, this.store);
    const allFiles = getTreeFiles(commit.tree, '', this.store);

    const normalizedPath = dirPath.replace(/^\/+|\/+$/g, '');
    const searchPath = normalizedPath ? normalizedPath + '/' : '';

    const files = [];
    const directories = new Set();

    for (const file of allFiles) {
      if (!file || !file.name) {
        continue; // Skip malformed entries
      }

      if (normalizedPath && !file.name.startsWith(searchPath)) {
        continue;
      }

      const relativePath = normalizedPath ?
        file.name.substring(searchPath.length) :
        file.name;

      if (!relativePath) {
        continue; // Skip empty paths
      }

      const pathParts = relativePath.split('/');

      if (pathParts.length === 1) {
        files.push({
          name: pathParts[0],
          type: 'file',
          hash: file.hash,
          binary: file.binary,
          size: this.getFileSizeFromHash(file.hash)
        });
      } else if (pathParts.length > 1) {
        directories.add(pathParts[0]);
      }
    }

    return {
      files: files.sort((a, b) => a.name.localeCompare(b.name)),
      directories: Array.from(directories).sort(),
      metadata: {
        hasCommits: true,
        path: normalizedPath,
        totalFiles: allFiles.length
      }
    };
  }

  /**
   * Check if file has changed from staged or HEAD
   */
  isFileChanged(fileName, newContent) {
    const newData = typeof newContent === 'string' ?
      stringToUint8Array(newContent) :
      new Uint8Array(newContent);

    if (this.debugMode) {
      console.log(`🔍 Checking if file '${fileName}' has changed (${newData.length} bytes)`);
    }

    // First check if file is already staged with same content
    const stagedInfo = this.stagingArea.get(fileName);
    if (stagedInfo) {
      if (this.debugMode) {
        console.log(`🔍 File '${fileName}' is already staged (${stagedInfo.size} bytes), comparing...`);
      }
      // Get staged content from chunking system using manifest hash
      const stagedContent = getFile(stagedInfo.hash, this.store);
      // Compare with staged content
      if (stagedContent.length === newData.length) {
        let identical = true;
        for (let i = 0; i < stagedContent.length; i++) {
          if (stagedContent[i] !== newData[i]) {
            identical = false;
            break;
          }
        }
        if (identical) {
          if (this.debugMode) {
            console.log(`🔍 File '${fileName}' is identical to staged version - no change`);
          }
          return false; // File is identical to staged version
        }
      }
      // File is staged but different content - this is a change
      if (this.debugMode) {
        console.log(`🔍 File '${fileName}' differs from staged version - has changed`);
      }
      return true;
    }

    // File not staged, check against HEAD commit
    const currentBranch = this.getCurrentBranch();
    const headCommit = this.store.getBranchHead(currentBranch);

    if (!headCommit) {
      // No commits yet, any file is new
      if (this.debugMode) {
        console.log(`🔍 No HEAD commit exists - file '${fileName}' is new`);
      }
      return true;
    }

    if (this.debugMode) {
      console.log(`🔍 Comparing file '${fileName}' against HEAD commit ${headCommit.slice(0, 8)}...`);
    }

    try {
      const commit = getCommit(headCommit, this.store);
      const tree = getTree(commit.tree, this.store);

      // Find file in tree
      const fileEntry = tree.find(entry => entry.name === fileName && entry.type === 'file');
      if (!fileEntry) {
        // File doesn't exist in HEAD, it's new
        if (this.debugMode) {
          console.log(`🔍 File '${fileName}' not found in HEAD commit - is new`);
        }
        return true;
      }

      // Get committed file content and compare
      const committedContent = getFile(fileEntry.hash, this.store);

      if (this.debugMode) {
        console.log(`🔍 Found file '${fileName}' in HEAD (${committedContent.length} bytes), comparing content...`);
      }

      // Compare content byte by byte
      if (committedContent.length !== newData.length) {
        if (this.debugMode) {
          console.log(`🔍 File '${fileName}' size differs: HEAD=${committedContent.length}, new=${newData.length} - has changed`);
        }
        return true;
      }

      for (let i = 0; i < committedContent.length; i++) {
        if (committedContent[i] !== newData[i]) {
          if (this.debugMode) {
            console.log(`🔍 File '${fileName}' content differs at byte ${i} - has changed`);
          }
          return true;
        }
      }

      if (this.debugMode) {
        console.log(`🔍 File '${fileName}' is identical to HEAD commit - no change`);
      }
      return false; // Files are identical to HEAD
    } catch (error) {
      // If any error occurs, assume file is changed
      if (this.debugMode) {
        console.log(`🔍 Error checking file '${fileName}': ${error.message} - assuming changed`);
      }
      return true;
    }
  }

  /**
   * Set debug mode
   */
  setDebugMode(enabled) {
    this.debugMode = enabled;
  }

  /**
   * Reconstruct archive from staging area
   */
  _reconstructArchiveFromStaging(fileName, stagedInfo) {
    if (this.debugMode) {
      console.log(`📦 Reconstructing archive: ${fileName} from staging area`);
    }

    // If original archive is preserved, return it directly
    if (stagedInfo.hash) {
      const originalArchive = getFile(stagedInfo.hash, this.store);
      if (originalArchive) {
        return originalArchive;
      }
    }

    // Get all internal files for this archive from staging area
    const internalFiles = [];
    for (const [internalFileName, internalInfo] of this.stagingArea) {
      if (internalInfo.archive &&
          internalInfo.archive.isArchiveRoot === false &&
          internalInfo.archive.parentArchive === fileName) {

        const content = getFile(internalInfo.hash, this.store);
        if (content) {
          internalFiles.push({
            internalPath: internalInfo.archive.internalPath,
            content: content,
            size: internalInfo.size,
            crc32: internalInfo.archive.crc32,
            lastModified: new Date(internalInfo.mtime * 1000)
          });
        }
      }
    }

    if (internalFiles.length === 0) {
      throw new Error(`No internal files found for archive: ${fileName}`);
    }

    // Reconstruct archive using detected format
    const format = stagedInfo.archive.format;
    if (this.debugMode) {
      console.log(`📦 Reconstructing ${internalFiles.length} files as ${format} archive`);
    }

    // Reconstruct using simple archive system
    if (!simpleArchive) {
      throw new Error('Archive reconstruction not available');
    }

    return simpleArchive.reconstructZip(internalFiles);
  }

  /**
   * Reconstruct archive from committed files
   */
  _reconstructArchiveFromCommit(fileName, commitHash, entry) {
    if (this.debugMode) {
      console.log(`📦 Reconstructing archive: ${fileName} from commit ${commitHash}`);
    }

    // If original archive is preserved, return it directly
    if (entry.hash) {
      const originalArchive = getFile(entry.hash, this.store);
      if (originalArchive) {
        return originalArchive;
      }
    }

    // Get all files from the commit
    const commit = getCommit(commitHash, this.store);
    const tree = getTree(commit.tree, this.store);

    // Find internal files for this archive
    const internalFiles = [];
    for (const treeEntry of tree) {
      if (treeEntry.type === 'file' &&
          treeEntry.archive &&
          treeEntry.archive.isArchiveRoot === false &&
          treeEntry.archive.parentArchive === fileName) {

        const content = getFile(treeEntry.hash, this.store);
        if (content) {
          internalFiles.push({
            internalPath: treeEntry.archive.internalPath,
            content: content,
            size: treeEntry.size || content.length,
            crc32: treeEntry.archive.crc32,
            lastModified: new Date((treeEntry.mtime || 0) * 1000)
          });
        }
      }
    }

    if (internalFiles.length === 0) {
      throw new Error(`No internal files found for archive: ${fileName}`);
    }

    // Reconstruct archive using detected format
    const format = entry.archive.format;
    if (this.debugMode) {
      console.log(`📦 Reconstructing ${internalFiles.length} files as ${format} archive`);
    }

    // Reconstruct using simple archive system
    if (!simpleArchive) {
      throw new Error('Archive reconstruction not available');
    }

    return simpleArchive.reconstructZip(internalFiles);
  }
}

module.exports = FileManager;