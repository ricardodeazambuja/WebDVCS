/**
 * WebDVCS CLI Interface - Command-line interface with logging and colors
 * Uses core library with CLI-specific wrappers for terminal output
 */

// Import core functionality
const coreLib = require('./webdvcs-core');
const {
  hashData, isBinary, arraysEqual, stringToUint8Array, uint8ArrayToString,
  getBlob, storeFile, getFile, hasFile,
  storeTree, getTree, createCommit, getCommit, getCommitHistory, commitExists, getTreeFiles,
  diffLines, getDiffSummary
} = coreLib;
const CoreMiniRepo = coreLib.MiniRepo;

// Import CLI-specific functionality
const { colorize, diffColors } = require('./lib/cli/cli-colors');
const { formatDiff, diffFiles } = require('./lib/cli/cli-diff');
const { initStore, storeBlob } = require('./lib/cli/cli-storage');
const { addFilesystemMethods } = require('./lib/cli/repo-fs-methods');

/**
 * CLI-enhanced MiniRepo with logging and disk operations
 */
class MiniRepo extends CoreMiniRepo {
  constructor(dbPath, debugMode = false) {
    super(dbPath, debugMode);
    this.debugMode = debugMode;
    // Wrap the storage methods to add CLI logging (only in debug mode)
    const originalStoreObject = this.store.storeObject.bind(this.store);
    this.store.storeObject = (content, type, compression) => {
      const result = originalStoreObject(content, type, compression);

      if (this.debugMode) {
        if (result.isNew) {
          console.log(`📦 Stored new ${type} ${result.hash.substring(0, 8)} (${content.length} bytes)`);
        } else {
          console.log(`🔄 ${type} ${result.hash.substring(0, 8)} already exists - deduplication!`);
        }
      }

      return result; // Return full result object for proper operation
    };
    
    // Add filesystem methods for CLI functionality
    addFilesystemMethods(this);
  }
  
  commit(message, author = null, email = null, options = {}) {
    const result = super.commit(message, author, email, options);
    console.log(`📝 Created commit ${result.commitHash} on branch '${result.branch}'`);
    return result; // Return full result object
  }
  
  checkout(commitRef, fileName = null, writeToDisk = false) {
    // Resolve symbolic references (HEAD, HEAD~1, etc.) to actual commit hash
    const commitHash = this.resolveCommitReference(commitRef);
    if (!commitHash) {
      throw new Error(`Invalid commit reference: ${commitRef}`);
    }

    const result = super.checkout(commitHash, fileName, writeToDisk);

    if (writeToDisk) {
      const fs = require('fs');
      const path = require('path');

      if (fileName) {
        // Single file checkout with metadata restoration
        this._writeFileWithMetadata(fileName, result.content, result.metadata);
      } else {
        // Full commit checkout with metadata restoration
        const filesMetadata = result.filesMetadata || {};

        // Handle regular files
        for (const [fileName, fileData] of Object.entries(result.files)) {
          const metadata = filesMetadata[fileName] || {};
          this._writeFileWithMetadata(fileName, fileData, metadata);
        }

        // Handle symlinks (which have no content but have metadata)
        for (const [fileName, metadata] of Object.entries(filesMetadata)) {
          if (metadata.type === 'symlink') {
            this._writeFileWithMetadata(fileName, null, metadata);
          }
        }
      }
    }

    return result;
  }

  /**
   * Write file to disk with metadata restoration
   * Cross-platform implementation with graceful degradation
   * @private
   */
  _writeFileWithMetadata(fileName, content, metadata) {
    const fs = require('fs');
    const path = require('path');
    const os = require('os');

    // Create directory if needed
    const dir = path.dirname(fileName);
    if (dir !== '.') {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Cross-platform compatibility flags
    const isWindows = os.platform() === 'win32';
    const supportsSymlinks = !isWindows || this._canCreateSymlinks();

    try {
      if (metadata.type === 'symlink') {
        // Create symlink with cross-platform support
        if (metadata.target) {
          if (supportsSymlinks) {
            // Remove existing file/symlink if it exists
            try {
              fs.unlinkSync(fileName);
            } catch (error) {
              // File doesn't exist, which is fine
            }

            try {
              fs.symlinkSync(metadata.target, fileName);

              if (this.options && this.options.debug) {
                console.log(`🔗 Created symlink: ${fileName} -> ${metadata.target}`);
              }
            } catch (error) {
              if (this.options && this.options.debug) {
                console.log(`⚠️ Could not create symlink ${fileName}: ${error.message}`);
                console.log(`📄 Creating regular file with symlink content instead`);
              }
              // Fallback: create a regular file with the target path as content
              fs.writeFileSync(fileName, `symlink:${metadata.target}`);
            }
          } else {
            if (this.options && this.options.debug) {
              console.log(`⚠️ Symlinks not supported on this platform, creating regular file: ${fileName}`);
            }
            // Fallback: create a regular file with the target path as content
            fs.writeFileSync(fileName, `symlink:${metadata.target}`);
          }
        }
      } else {
        // Write regular file
        fs.writeFileSync(fileName, content);

        if (this.options && this.options.debug) {
          console.log(`📄 Wrote file: ${fileName} (${content ? content.length : 0} bytes)`);
        }
      }

      // Restore file permissions with cross-platform handling
      if (metadata.mode && metadata.mode !== 0) {
        try {
          // Convert mode to octal permissions (remove file type bits)
          const permissions = metadata.mode & 0o777;

          if (isWindows) {
            // Windows: Map Unix permissions to Windows attributes as best as possible
            // Windows doesn't have full POSIX permissions, but we can handle read-only
            const isReadable = permissions & 0o400;
            const isWritable = permissions & 0o200;

            if (!isWritable) {
              // Make file read-only if write permission is not set
              const stats = fs.statSync(fileName);
              const newMode = stats.mode & ~0o200; // Remove write bit
              fs.chmodSync(fileName, newMode);

              if (this.options && this.options.debug) {
                console.log(`🔐 Set Windows read-only: ${fileName}`);
              }
            } else {
              if (this.options && this.options.debug) {
                console.log(`🔐 Windows permissions limited: ${fileName} (kept default)`);
              }
            }
          } else {
            // Unix-like systems: Full permission support
            fs.chmodSync(fileName, permissions);

            if (this.options && this.options.debug) {
              console.log(`🔐 Set permissions: ${fileName} -> ${permissions.toString(8)}`);
            }
          }
        } catch (error) {
          if (this.options && this.options.debug) {
            console.log(`⚠️ Could not set permissions for ${fileName}: ${error.message}`);
          }
        }
      }

      // Restore timestamps if available
      if (metadata.mtime && metadata.mtime !== 0) {
        try {
          const mtime = new Date(metadata.mtime * 1000); // Convert from Unix timestamp
          fs.utimesSync(fileName, mtime, mtime);

          if (this.options && this.options.debug) {
            console.log(`⏰ Set timestamp: ${fileName} -> ${mtime.toISOString()}`);
          }
        } catch (error) {
          if (this.options && this.options.debug) {
            console.log(`⚠️ Could not set timestamp for ${fileName}: ${error.message}`);
          }
        }
      }

    } catch (error) {
      console.error(`❌ Error writing ${fileName}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Check if symlinks can be created on Windows
   * @private
   */
  _canCreateSymlinks() {
    if (require('os').platform() !== 'win32') {
      return true; // Non-Windows systems generally support symlinks
    }

    try {
      const fs = require('fs');
      const path = require('path');
      const os = require('os');

      // Try to create a test symlink in temp directory
      const tempDir = os.tmpdir();
      const testTarget = path.join(tempDir, 'webdvcs-symlink-test-target');
      const testLink = path.join(tempDir, 'webdvcs-symlink-test-link');

      // Create test target file
      fs.writeFileSync(testTarget, 'test');

      try {
        // Try to create symlink
        fs.symlinkSync(testTarget, testLink);

        // Clean up
        fs.unlinkSync(testLink);
        fs.unlinkSync(testTarget);

        return true;
      } catch (error) {
        // Clean up target file
        try {
          fs.unlinkSync(testTarget);
        } catch (cleanupError) {
          // Ignore cleanup errors
        }

        if (this.options && this.options.debug) {
          console.log(`⚠️ Symlink test failed on Windows: ${error.message}`);
          console.log(`   This usually means developer mode is not enabled or insufficient privileges`);
        }

        return false;
      }
    } catch (error) {
      if (this.options && this.options.debug) {
        console.log(`⚠️ Could not test symlink capability: ${error.message}`);
      }
      return false;
    }
  }
  
  addFileFromDisk(fileName, forceBinary = false) {
    const fs = require('fs');
    if (!fs.existsSync(fileName)) {
      throw new Error(`File not found: ${fileName}`);
    }

    // Capture comprehensive file metadata using lstat (handles symlinks properly)
    const fileStats = fs.lstatSync(fileName);
    const isSymlink = fileStats.isSymbolicLink();

    let content = null;
    let target = null;

    if (isSymlink) {
      // For symlinks, read the target path instead of content
      target = fs.readlinkSync(fileName);
    } else {
      // For regular files, read the content
      content = fs.readFileSync(fileName);
    }

    // Create enhanced metadata object
    const metadata = {
      mode: fileStats.mode,
      mtime: Math.floor(fileStats.mtime.getTime() / 1000), // Convert to Unix timestamp
      size: fileStats.size,
      type: isSymlink ? 'symlink' : 'file',
      target: target
    };

    // Use enhanced _addFileInternal with metadata
    const result = this._addFileInternal(fileName, content, forceBinary, metadata);

    // Save staging area after adding file
    this.saveStagingArea();

    return result; // Return full result object, not just binary flag
  }
}

// Enhanced storeFile with CLI logging
function storeFileEnhanced(data, fileName = '', store, baseHash = null) {
  const coreResult = storeFile(data, fileName, store, baseHash);
  
  // CLI logging for large files
  if (coreResult.chunkCount > 1) {
    console.log(`📦 Stored ${coreResult.chunkCount} chunks for ${fileName || 'file'} (${coreResult.totalSize} bytes)`);
  }
  
  return coreResult.manifestHash;
}

// Export CLI interface with enhanced functionality
module.exports = {
  // Core classes with CLI enhancements
  MiniRepo,
  
  // Storage functions with CLI logging
  initStore,
  storeBlob,
  getBlob,
  
  // Utility functions (pure)
  hashData,
  isBinary,
  arraysEqual,
  stringToUint8Array,
  uint8ArrayToString,
  
  // File operations with CLI logging
  storeFile: storeFileEnhanced,
  getFile,
  hasFile,
  
  // Tree and commit operations (pure)
  storeTree,
  getTree,
  createCommit,
  getCommit,
  getCommitHistory,
  commitExists,
  getTreeFiles,
  
  // Diff functionality with CLI colors
  colorize,
  diffLines,
  formatDiff,
  diffFiles,
  getDiffSummary,
  diffColors
};