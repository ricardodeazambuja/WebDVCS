
const { storeFile } = require('./file-storage');
const { isBinary, stringToUint8Array } = require('./utils');

let simpleArchive;
try {
  simpleArchive = require('./simple-archive');
} catch (error) {
  simpleArchive = null;
}

class StagingArea {
  constructor(config) {
    if (!config?.store) {
      throw new Error('StagingArea requires store');
    }

    this.store = config.store;
    this.stagingArea = config.stagingArea;
    this.removedFiles = config.removedFiles;
    this.getFile = config.getFile;
    this.listCommitFiles = config.listCommitFiles;
    this.getCurrentCommit = config.getCurrentCommit;
    this.debugMode = false;

    // Archive processing options
    this.archiveOptions = {
      processArchives: true,                  // Enable archive decomposition
      maxArchiveSize: 100 * 1024 * 1024,    // 100MB max
      maxInternalFiles: 1000,               // Max files per archive
      autoDetect: true,                     // Auto-detect archive formats
      preserveOriginal: false,              // Don't store original archive
      ...(config.archiveOptions || {})
    };
  }

  /**
   * Internal file staging with delta compression and metadata support (enhanced with archive processing)
   */
  _addFileInternal(fileName, content, forceBinary = false, metadata) {
    // Prepare data
    const data = typeof content === 'string' ?
      stringToUint8Array(content) :
      new Uint8Array(content);

    // Archive processing check (if enabled and available)
    if (this.archiveOptions.processArchives &&
        this.archiveOptions.autoDetect &&
        !forceBinary &&
        simpleArchive &&
        simpleArchive.isArchiveFile(data, fileName)) {

      try {
        return this._addArchiveFile(fileName, data, metadata);
      } catch (error) {
        if (this.debugMode) {
          console.log(`⚠️  Archive processing failed for ${fileName}: ${error.message}`);
          console.log(`📄 Falling back to regular file processing`);
        }
        // Fall through to regular file processing
      }
    }

    // Handle symlinks
    const isSymlink = metadata.type === 'symlink';
    if (isSymlink) {
      return this._addSymlinkFile(fileName, metadata);
    }

    // Regular file processing (original implementation)
    return this._addRegularFile(fileName, data, forceBinary, metadata);
  }

  /**
   * Process archive files by extracting and storing internal files (simplified)
   */
  _addArchiveFile(fileName, data, metadata) {
    if (this.debugMode) {
      console.log(`📦 Processing archive: ${fileName} (${data.length} bytes)`);
    }

    // Extract internal files from archive using simple synchronous extraction
    const extractedFiles = simpleArchive.extractZipFiles(data, fileName);

    if (extractedFiles.length > this.archiveOptions.maxInternalFiles) {
      throw new Error(`Archive contains too many files: ${extractedFiles.length} (max: ${this.archiveOptions.maxInternalFiles})`);
    }

    // Store archive root entry (preserve original if enabled)
    let archiveHash = null;
    if (this.archiveOptions.preserveOriginal) {
      const storeResult = this._storeWithDelta(data, fileName);
      archiveHash = storeResult.hash;
    }

    this.stagingArea.set(fileName, {
      hash: archiveHash, // null if not preserving original
      fileName: fileName,
      size: data.length,
      binary: false, // Archive root is treated as structured data
      // Standard metadata fields
      mode: metadata.mode,
      mtime: metadata.mtime,
      type: 'archive',
      target: null
    });

    // Store each internal file separately for delta compression
    const internalFileResults = [];
    for (const internalFile of extractedFiles) {
      const internalResult = this._addInternalFile(fileName, internalFile);
      internalFileResults.push(internalResult);
    }

    if (this.debugMode) {
      console.log(`📦 Archive processed: ${fileName} → ${extractedFiles.length} internal files`);
      extractedFiles.forEach(f => {
        console.log(`  ├── ${f.internalPath} (${f.size} bytes)`);
      });
    }

    return {
      fileName,
      binary: false,
      size: data.length,
      type: 'archive',
      target: null,
      archive: {
        processed: true,
        internalFileCount: extractedFiles.length,
        internalFiles: internalFileResults
      }
    };
  }

  /**
   * Store internal file from archive (simplified)
   */
  _addInternalFile(parentArchive, internalFile) {
    const internalFileName = internalFile.fullPath; // e.g., "document.docx/word/document.xml"
    const internalData = internalFile.content;

    // Detect if internal file is binary
    const binary = isBinary(internalData, internalFile.internalPath);

    // Store internal file with delta compression
    const storeResult = this._storeWithDelta(internalData, internalFileName);

    // Add to staging area with internal file path
    this.stagingArea.set(internalFileName, {
      hash: storeResult.hash,
      fileName: internalFileName,
      size: internalFile.size,
      binary: binary,
      // Standard metadata
      mode: 0o644,
      mtime: Math.floor(Date.now() / 1000),
      type: 'file',
      target: null
    });

    if (this.debugMode) {
      console.log(`  📄 Added internal file: ${internalFile.internalPath} (${internalFile.size} bytes, ${binary ? 'binary' : 'text'})`);
    }

    return {
      fileName: internalFileName,
      internalPath: internalFile.internalPath,
      size: internalFile.size,
      binary: binary,
      hash: storeResult.hash
    };
  }

  /**
   * Store regular (non-archive) file - original implementation
   */
  _addRegularFile(fileName, data, forceBinary, metadata) {
    // Detect if file is binary
    const binary = forceBinary || isBinary(data, fileName);

    // Store with delta compression (always store, even for empty files)
    const storeResult = this._storeWithDelta(data, fileName);
    const hash = storeResult.hash;

    // Store entry in staging area with metadata
    this.stagingArea.set(fileName, {
      hash: hash,
      fileName: fileName,
      size: metadata.size,
      binary: binary,
      // Standard metadata fields
      mode: metadata.mode,
      mtime: metadata.mtime,
      type: metadata.type,
      target: metadata.target
    });

    if (this.debugMode) {
      console.log(`📄 Added regular file: ${fileName} (${data.length} bytes, ${binary ? 'binary' : 'text'})`);
    }

    return {
      fileName,
      binary,
      size: metadata.size,
      type: metadata.type,
      target: metadata.target
    };
  }

  /**
   * Store symlink file - original implementation
   */
  _addSymlinkFile(fileName, metadata) {
    // Symlinks have no content, just metadata
    this.stagingArea.set(fileName, {
      hash: null, // No content hash for symlinks
      fileName: fileName,
      size: 0,
      binary: false,
      // Standard metadata fields
      mode: metadata.mode,
      mtime: metadata.mtime,
      type: metadata.type,
      target: metadata.target
    });

    if (this.debugMode) {
      console.log(`🔗 Added symlink: ${fileName} -> ${metadata.target}`);
    }

    return {
      fileName,
      binary: false,
      size: 0,
      type: 'symlink',
      target: metadata.target
    };
  }

  /**
   * Store file with delta compression (extracted from original implementation)
   */
  _storeWithDelta(data, fileName) {
    let baseHash = null;

    // Check if file already exists in staging area (updating staged file)
    if (this.stagingArea.has(fileName)) {
      baseHash = this.stagingArea.get(fileName).hash;
    } else {
      // Check if file exists in current commit (adding new version of committed file)
      try {
        const currentCommit = this.getCurrentCommit();
        const currentCommitFiles = this.listCommitFiles(currentCommit);
        if (currentCommitFiles.includes(fileName)) {
          const existingFileInfo = this.getFile(fileName);
          if (existingFileInfo && existingFileInfo.hash) {
            baseHash = existingFileInfo.hash;
          }
        }
      } catch (error) {
        // No current commit or file doesn't exist, proceed without base
      }
    }

    // Use pure delta compression (Fossil-style)
    return storeFile(data, fileName, this.store, baseHash);
  }


  /**
   * Save staging area to metadata
   */
  saveStagingArea() {
    const stagingData = {};
    for (const [path, stagedInfo] of this.stagingArea) {
      // Staging area now contains hash references, not actual data
      // This format is already perfect for persistence
      stagingData[path] = {
        size: stagedInfo.size,
        hash: stagedInfo.hash,
        binary: stagedInfo.binary,
        isStaged: true,
        timestamp: Date.now()
        // Note: Actual file content is NOT stored here - only the hash reference
        // Content is retrieved from blob storage using the hash when needed
      };
    }
    this.store.setMeta('staging_area', stagingData);
  }

  /**
   * Save removed files to metadata
   */
  saveRemovedFiles() {
    const removedArray = Array.from(this.removedFiles);
    this.store.setMeta('removed_files', removedArray);
  }

  /**
   * Get staged files list (enhanced to handle virtual file system)
   */
  getStagedFiles() {
    return this.getVisibleFiles();
  }

  /**
   * Get list of user-visible files (hides internal archive files)
   */
  getVisibleFiles() {
    const allFiles = Array.from(this.stagingArea.keys());
    const visibleFiles = [];

    for (const fileName of allFiles) {
      const stagedInfo = this.stagingArea.get(fileName);

      // Show archive roots and regular files, hide internal files
      if (!stagedInfo.archive || stagedInfo.archive.isArchiveRoot !== false) {
        visibleFiles.push(fileName);
      }
    }

    return visibleFiles.sort();
  }

  /**
   * Get internal files for a specific archive
   */
  getArchiveInternalFiles(archiveFileName) {
    const allFiles = Array.from(this.stagingArea.keys());
    const internalFiles = [];

    for (const fileName of allFiles) {
      const stagedInfo = this.stagingArea.get(fileName);

      if (stagedInfo.archive &&
          stagedInfo.archive.isArchiveRoot === false &&
          stagedInfo.archive.parentArchive === archiveFileName) {
        internalFiles.push({
          fullPath: fileName,
          internalPath: stagedInfo.archive.internalPath,
          size: stagedInfo.size,
          binary: stagedInfo.binary,
          hash: stagedInfo.hash
        });
      }
    }

    return internalFiles.sort((a, b) => a.internalPath.localeCompare(b.internalPath));
  }

  /**
   * Check if a file is an archive
   */
  isArchiveFile(fileName) {
    const stagedInfo = this.stagingArea.get(fileName);
    return stagedInfo &&
           stagedInfo.type === 'archive' &&
           stagedInfo.archive &&
           stagedInfo.archive.isArchiveRoot === true;
  }

  /**
   * Clear staging area and removed files (extracted from browser-entry.js lines 203-209)
   */
  clearStagingArea() {
    this.stagingArea.clear();
    this.removedFiles.clear();
    this.saveStagingArea();
    this.saveRemovedFiles();
  }

  /**
   * Get staging area size (count only visible files)
   */
  size() {
    return this.getVisibleFiles().length;
  }

  /**
   * Check if staging area is empty (check only visible files)
   */
  isEmpty() {
    return this.getVisibleFiles().length === 0;
  }

  /**
   * Check if file is staged
   */
  isStaged(fileName) {
    return this.stagingArea.has(fileName);
  }

  /**
   * Get staged file info
   */
  getStagedFile(fileName) {
    return this.stagingArea.get(fileName);
  }

  /**
   * Check if file is marked for removal
   */
  isMarkedForRemoval(fileName) {
    return this.removedFiles.has(fileName);
  }

  /**
   * Get count of removed files
   */
  getRemovedFilesCount() {
    return this.removedFiles.size;
  }

  /**
   * Get removed files array
   */
  getRemovedFiles() {
    return Array.from(this.removedFiles);
  }

  /**
   * Set debug mode
   */
  setDebugMode(enabled) {
    this.debugMode = enabled;
  }
}

module.exports = StagingArea;