/**
 * WebDVCS Core Library - Pure VCS functionality (no interface dependencies)
 * Provides clean, interface-agnostic version control system capabilities
 */

// Environment detection
const isNode = typeof window === 'undefined' && typeof require !== 'undefined';
const isBrowser = typeof window !== 'undefined';

// Import from lib/core/ modules (pure functions only)
if (isNode) {
  // Node.js environment - import from core modules
  const { hashData, isBinary, arraysEqual, stringToUint8Array, uint8ArrayToString } = require('./lib/core/utils');
  const { ContentAddressedStore, initStore } = require('./lib/core/storage');
  const { storeBlob, getBlob } = require('./lib/core/objects');
  const { storeFile, getFile, hasFile } = require('./lib/core/file-storage');
  const { storeTree, getTree, createCommit, getCommit, getCommitHistory, commitExists, getTreeFiles } = require('./lib/core/objects');
  const { diffLines, formatDiff, diffFiles, getDiffSummary } = require('./lib/core/diff');
  const { ContentAddressedRepo } = require('./lib/core/repo');
  
  // Export pure core functionality only (no console, no colors, no fs)
  module.exports = {
    // Core classes
    MiniRepo: ContentAddressedRepo,
    
    // Storage functions (pure)
    initStore: (dbPath, DatabaseConstructor) => new ContentAddressedStore(dbPath, DatabaseConstructor),
    storeBlob,
    getBlob,
    
    // Utility functions (pure)
    hashData,
    isBinary,
    arraysEqual,
    stringToUint8Array,
    uint8ArrayToString,
    
    // File operations (pure delta)
    storeFile,
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
    
    // Diff functionality (pure, no colors)
    diffLines,
    formatDiff,
    diffFiles,
    getDiffSummary,
    
    // Environment info
    isNode,
    isBrowser
  };
} else if (isBrowser) {
  // Browser environment - core functions available
  window.WebDVCSCore = {
    isNode,
    isBrowser,
    note: 'Core functionality available. Use webdvcs-web.js for browser interface.'
  };
}