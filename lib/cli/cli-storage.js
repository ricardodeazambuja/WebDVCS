/**
 * CLI Storage - CLI wrapper with filesystem operations and console logging
 */

const fs = require('fs');
const { initStore: coreInitStore, storeBlob: coreStoreBlob, getBlob } = require('../core/storage');

// Track initialized stores for CLI logging
const cliStores = new Map();

/**
 * Initialize CLI store with filesystem checking and logging wrapper
 * @param {string} dbPath - Database file path
 * @returns {Object} Store with CLI logging and filesystem operations
 */
function initStore(dbPath = 'webdvcs.sqlite') {
  // CLI-specific: check if file exists and remove stale instances
  if (dbPath !== ':memory:' && cliStores.has(dbPath)) {
    const existingStore = cliStores.get(dbPath);
    if (!fs.existsSync(dbPath)) {
      // File was deleted, remove stale instance
      cliStores.delete(dbPath);
    } else {
      return existingStore;
    }
  }
  
  const coreStore = coreInitStore(dbPath);
  
  // Create CLI wrapper
  const cliStore = {
    ...coreStore,
    
    // Override storeBlob to add CLI logging
    storeBlob(data) {
      const result = coreStore.storeBlob(data);
      
      // Debug logging removed for production
      
      return result.hash; // Return just the hash for compatibility
    },

    // Enhanced analytics with filesystem info (CLI-specific)
    getAnalytics() {
      const coreAnalytics = coreStore.getAnalytics();
      
      // Add database file size (CLI-specific)
      let dbSize = 0;
      if (dbPath !== ':memory:') {
        try {
          dbSize = fs.statSync(dbPath).size;
        } catch (error) {
          dbSize = 0;
        }
      }
      
      return {
        ...coreAnalytics,
        db_size: dbSize
      };
    },

    // Enhanced getStats with filesystem dbSize (CLI-specific)
    getStats() {
      const coreStats = coreStore.getStats();
      
      // Add database file size (CLI-specific)
      let dbSize = 0;
      if (dbPath !== ':memory:') {
        try {
          dbSize = fs.statSync(dbPath).size;
        } catch (error) {
          dbSize = 0;
        }
      }
      
      return {
        ...coreStats,
        dbSize: dbSize
      };
    }
  };
  
  cliStores.set(dbPath, cliStore);
  return cliStore;
}

/**
 * Store blob with CLI logging
 * @param {Uint8Array} data - Data to store
 * @returns {string} Hash of stored blob
 */
function storeBlob(data) {
  const result = coreStoreBlob(data);
  
  // Debug logging removed for production
  
  return result.hash;
}

module.exports = {
  initStore,
  storeBlob,
  getBlob
};