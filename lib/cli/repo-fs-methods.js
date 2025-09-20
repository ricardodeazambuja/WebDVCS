/**
 * CLI Filesystem Extensions for MiniRepo
 * 
 * These methods were extracted from lib/core/repo.js to keep the core
 * universal and free of filesystem dependencies. This module provides
 * filesystem-specific operations that only work in Node.js environments.
 */

const fs = require('fs');
const path = require('path');
const { isBinary } = require('../core/utils');

/**
 * Walk directory recursively and return all files
 * Extracted from MiniRepo.walkDirectory()
 */
function walkDirectorySync(dirPath, basePath = '', options = {}) {
  const files = [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  
  if (options.debug && files.length % 100 === 0) {
    console.log(`🔍 Scanning: ${dirPath}`);
  }
  
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    const relativePath = basePath ? path.join(basePath, entry.name) : entry.name;
    
    if (entry.isDirectory()) {
      // Recursively walk subdirectories
      files.push(...walkDirectorySync(fullPath, relativePath, options));
    } else if (entry.isFile()) {
      files.push({
        fullPath,
        relativePath,
        isDirectory: false
      });
    }
  }
  
  return files;
}

/**
 * Add entire directory recursively to a MiniRepo instance
 * Extracted from MiniRepo.addDirectory()
 */
function addDirectoryToRepo(repo, dirPath, options = {}) {
  if (!fs.existsSync(dirPath)) {
    throw new Error(`Directory not found: ${dirPath}`);
  }
  
  const stats = fs.statSync(dirPath);
  if (!stats.isDirectory()) {
    throw new Error(`Not a directory: ${dirPath}`);
  }
  
  const baseName = path.basename(dirPath);
  const files = walkDirectorySync(dirPath, '', options);
  let addedCount = 0;
  let skippedCount = 0;
  const addedFiles = [];
  const fileMetadata = JSON.parse(repo.store.getMeta('file_metadata') || '{}');
  
  if (options.debug) {
    console.log(`🔍 Found ${files.length} files to process`);
  }
  
  for (const file of files) {
    try {
      // Capture comprehensive file metadata using lstat (handles symlinks properly)
      const fileStats = fs.lstatSync(file.fullPath);
      const isSymlink = fileStats.isSymbolicLink();

      const fileSize = fileStats.size;
      const sizeStr = fileSize > 1024 * 1024 ?
        `${(fileSize / (1024 * 1024)).toFixed(1)}MB` :
        fileSize > 1024 ? `${(fileSize / 1024).toFixed(1)}KB` : `${fileSize}B`;

      if (options.debug) {
        const typeStr = isSymlink ? '(symlink)' : fileStats.isFile() ? '(file)' : '(other)';
        console.log(`🔍 Processing: ${file.relativePath} ${typeStr} (${sizeStr}) (${addedCount + 1}/${files.length})`);
      }

      // Prepare file data with metadata
      let content = null;
      let target = null;

      if (isSymlink) {
        // For symlinks, read the target path instead of content
        target = fs.readlinkSync(file.fullPath);
      } else {
        // For regular files, read the content
        content = fs.readFileSync(file.fullPath);
      }

      // Store with relative path including base directory name
      const storagePath = path.join(baseName, file.relativePath);

      // Create enhanced metadata object
      const metadata = {
        mode: fileStats.mode,
        mtime: Math.floor(fileStats.mtime.getTime() / 1000), // Convert to Unix timestamp
        size: fileStats.size,
        type: isSymlink ? 'symlink' : 'file',
        target: target
      };

      // Use enhanced _addFileInternal with metadata
      const result = repo._addFileInternal(storagePath, content, options.forceBinary, metadata);
      
      addedFiles.push({
        path: storagePath,
        size: content.length,
        binary: result.binary,
        hash: result.hash
      });
      
      // Track file metadata
      fileMetadata[storagePath] = {
        originalPath: file.fullPath,
        addedAt: Date.now(),
        size: content.length,
        binary: result.binary
      };
      
      addedCount++;
      
      if (options.debug) {
        console.log(`📦 Added ${storagePath} ${result.binary ? '(binary)' : '(text)'} - ${result.size} bytes`);
      }
      
    } catch (error) {
      if (options.debug) {
        console.log(`⚠️ Skipped ${file.relativePath}: ${error.message}`);
      }
      skippedCount++;
    }
  }
  
  // Save updated metadata
  repo.store.setMeta('file_metadata', JSON.stringify(fileMetadata));
  
  // Save staging area after bulk operation
  if (addedCount > 0) {
    repo.saveStagingArea();
  }
  
  if (options.debug) {
    console.log(`📋 Directory scan complete: ${addedCount} added, ${skippedCount} skipped`);
  }
  
  return {
    added: addedCount,
    skipped: skippedCount,
    files: addedFiles,
    total: files.length
  };
}

/**
 * Get database file size from filesystem
 * Helper for stats calculation when filesystem is available
 */
function getDatabaseFileSize(dbPath) {
  if (!dbPath || dbPath === ':memory:') {
    return 0;
  }
  
  try {
    return fs.statSync(dbPath).size;
  } catch (error) {
    return 0; // File doesn't exist or can't be read
  }
}

/**
 * Add filesystem methods to a MiniRepo instance
 * This creates a CLI-enhanced repo with filesystem operations
 */
function addFilesystemMethods(repo) {
  // Add directory scanning method
  repo.addDirectory = function(dirPath, options = {}) {
    return addDirectoryToRepo(this, dirPath, options);
  };
  
  // Add directory walking method  
  repo.walkDirectory = function(dirPath, basePath = '', options = {}) {
    return walkDirectorySync(dirPath, basePath, options);
  };
  
  // Enhance getStats to include filesystem database size when available (if getStats exists)
  if (typeof repo.getStats === 'function') {
    const originalGetStats = repo.getStats.bind(repo);
    repo.getStats = function() {
      const stats = originalGetStats();
      
      // Add filesystem database size if available
      const fsDbSize = getDatabaseFileSize(this.store.dbPath);
      if (fsDbSize > 0) {
        stats.dbFileSize = fsDbSize;
        // Update efficiency calculation with actual file size
        const dataSize = stats.totalDataSize || 0;
        if (dataSize > 0) {
          stats.overhead = fsDbSize - dataSize;
          stats.efficiency = (dataSize / fsDbSize * 100);
        }
      }
      
      return stats;
    };
  } else {
    // Add getStats method if it doesn't exist
    repo.getStats = function() {
      // Basic stats with filesystem database size
      const fsDbSize = getDatabaseFileSize(this.store.dbPath);
      return {
        database: {
          file_path: this.store.dbPath,
          file_size_bytes: fsDbSize,
          file_size_mb: (fsDbSize / 1024 / 1024).toFixed(2)
        },
        note: 'Basic filesystem stats - full stats require storageAnalytics method'
      };
    };
  }
  
  return repo;
}

module.exports = {
  walkDirectorySync,
  addDirectoryToRepo,
  getDatabaseFileSize,
  addFilesystemMethods
};