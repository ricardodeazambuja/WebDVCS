/**
 * Content-Addressed Object Operations
 * Blob, Tree, and Commit object handling
 */

const { ContentAddressedStore } = require('./storage');

/**
 * Store a blob object
 * @param {Uint8Array} content - File content
 * @param {ContentAddressedStore} store - Storage instance
 * @returns {Object} - {hash, isNew}
 */
function storeBlob(content, store) {
  return store.storeObject(content, 'blob', 'zlib');
}

/**
 * Get a blob object
 * @param {string} hash - Blob hash
 * @param {ContentAddressedStore} store - Storage instance
 * @returns {Uint8Array|null} - Blob content
 */
function getBlob(hash, store) {
  const obj = store.getObject(hash);
  if (!obj || obj.type !== 'blob') return null;
  return obj.data;
}

/**
 * Store a tree object
 * @param {Array} entries - Tree entries [{name, type, hash, mode, mtime, size, target}]
 * @param {ContentAddressedStore} store - Storage instance
 * @returns {string} - Tree hash
 */
function storeTree(entries, store) {
  // Sort entries by name for consistent hashing
  const sortedEntries = [...entries].sort((a, b) => a.name.localeCompare(b.name));

  // Serialize tree format:
  // mode name hash type [mtime size target binary]
  const lines = [];
  for (const entry of sortedEntries) {
    let line = `${entry.mode || '100644'} ${entry.name} ${entry.hash || ''} ${entry.type}`;

    if (entry.mtime !== undefined) line += ` ${entry.mtime}`;
    if (entry.size !== undefined) line += ` ${entry.size}`;
    if (entry.target) line += ` ${entry.target}`;
    if (entry.binary !== undefined) line += ` ${entry.binary ? 'binary' : 'text'}`;

    lines.push(line);
  }

  const treeContent = lines.join('\n');
  const contentArray = new TextEncoder().encode(treeContent);

  const result = store.storeObject(contentArray, 'tree', 'zlib');
  return result.hash;
}

/**
 * Get a tree object
 * @param {string} hash - Tree hash
 * @param {ContentAddressedStore} store - Storage instance
 * @returns {Array|null} - Tree entries
 */
function getTree(hash, store) {
  const obj = store.getObject(hash);
  if (!obj || obj.type !== 'tree') return null;

  const treeContent = new TextDecoder().decode(obj.data);
  if (!treeContent.trim()) return [];

  const entries = [];
  for (const line of treeContent.split('\n')) {
    if (!line.trim()) continue;

    const parts = line.split(' ');
    if (parts.length < 4) continue;

    const entry = {
      mode: parseInt(parts[0]),
      name: parts[1],
      hash: parts[2] || null,
      type: parts[3]
    };

    // Optional fields - detect format dynamically
    let index = 4;
    // Check if parts[4] is numeric (mtime) or string (size/target/binary)
    if (parts.length > index && parts[index] !== '' && !isNaN(parseInt(parts[index]))) {
      entry.mtime = parseInt(parts[index]);
      index++;
    }
    if (parts.length > index && parts[index] !== '' && !isNaN(parseInt(parts[index]))) {
      entry.size = parseInt(parts[index]);
      index++;
    }
    if (parts.length > index && parts[index] !== '' && parts[index] !== 'binary' && parts[index] !== 'text') {
      entry.target = parts[index];
      index++;
    }
    if (parts.length > index && (parts[index] === 'binary' || parts[index] === 'text')) {
      entry.binary = parts[index] === 'binary';
      index++;
    }

    // Set binary flag for files if not already set
    if (entry.type === 'file' && entry.binary === undefined) {
      entry.binary = false; // Default to text if not specified
    }

    entries.push(entry);
  }

  return entries;
}

/**
 * Create a commit object
 * @param {string} treeHash - Tree hash
 * @param {string} message - Commit message
 * @param {string} author - Author name
 * @param {string} email - Author email
 * @param {string|null} parentHash - Parent commit hash
 * @param {ContentAddressedStore} store - Storage instance
 * @returns {string} - Commit hash
 */
function createCommit(treeHash, message, author, email, parentHash, store) {
  const timestamp = Math.floor(Date.now() / 1000);

  // Serialize commit format
  const lines = [`tree ${treeHash}`];
  if (parentHash) {
    lines.push(`parent ${parentHash}`);
  }
  lines.push(`author ${author} <${email || 'unknown@example.com'}> ${timestamp}`);
  lines.push(`message ${message}`);

  const commitContent = lines.join('\n');
  const contentArray = new TextEncoder().encode(commitContent);

  const result = store.storeObject(contentArray, 'commit', 'zlib');
  return result.hash;
}

/**
 * Get a commit object
 * @param {string} hash - Commit hash
 * @param {ContentAddressedStore} store - Storage instance
 * @returns {Object|null} - Commit object
 */
function getCommit(hash, store) {
  const obj = store.getObject(hash);
  if (!obj || obj.type !== 'commit') return null;

  const commitContent = new TextDecoder().decode(obj.data);
  const lines = commitContent.split('\n');

  const commit = {
    hash: hash,
    tree: null,
    parent: null,
    author: 'Unknown',
    email: null,
    timestamp: 0,
    message: ''
  };

  for (const line of lines) {
    if (line.startsWith('tree ')) {
      commit.tree = line.substring(5);
    } else if (line.startsWith('parent ')) {
      commit.parent = line.substring(7);
    } else if (line.startsWith('author ')) {
      const authorLine = line.substring(7);
      const match = authorLine.match(/^(.+) <(.*)> (\d+)$/);
      if (match) {
        commit.author = match[1];
        commit.email = match[2];
        commit.timestamp = parseInt(match[3]);
      }
    } else if (line.startsWith('message ')) {
      commit.message = line.substring(8);
    }
  }

  return commit;
}

/**
 * Get commit history
 * @param {string} startHash - Starting commit hash
 * @param {number} maxCount - Maximum commits to return
 * @param {ContentAddressedStore} store - Storage instance
 * @returns {Array} - Array of commit objects
 */
function getCommitHistory(startHash, maxCount, store) {
  const commits = [];
  const visited = new Set();
  const queue = [startHash];

  while (queue.length > 0 && commits.length < maxCount) {
    const commitHash = queue.shift();

    if (visited.has(commitHash)) continue;
    visited.add(commitHash);

    const commit = getCommit(commitHash, store);
    if (!commit) continue;

    commits.push(commit);

    // Add parent to queue for traversal
    if (commit.parent && !visited.has(commit.parent)) {
      queue.push(commit.parent);
    }
  }

  return commits;
}

/**
 * Find merge base between two commits
 * @param {string} hash1 - First commit hash
 * @param {string} hash2 - Second commit hash
 * @param {ContentAddressedStore} store - Storage instance
 * @returns {string|null} - Merge base commit hash
 */
function findMergeBase(hash1, hash2, store) {
  const history1 = getCommitHistory(hash1, 1000, store);
  const history2 = getCommitHistory(hash2, 1000, store);

  const hashes2 = new Set(history2.map(c => c.hash));

  for (const commit of history1) {
    if (hashes2.has(commit.hash)) {
      return commit.hash;
    }
  }

  return null;
}

/**
 * Get optimized commit history for a branch
 * @param {string} branchHash - Branch head commit hash
 * @param {Array} otherBranches - Other branch head hashes
 * @param {ContentAddressedStore} store - Storage instance
 * @returns {Array} - Optimized commit list
 */
function getOptimizedCommitHistory(branchHash, otherBranches, store) {
  if (otherBranches.length === 0) {
    return getCommitHistory(branchHash, 1000, store);
  }

  // Find closest merge base with any other branch
  let closestMergeBase = null;
  let shortestDistance = Infinity;

  for (const otherHash of otherBranches) {
    const mergeBase = findMergeBase(branchHash, otherHash, store);
    if (mergeBase) {
      const branchHistory = getCommitHistory(branchHash, 1000, store);
      const distance = branchHistory.findIndex(c => c.hash === mergeBase);

      if (distance !== -1 && distance < shortestDistance) {
        shortestDistance = distance;
        closestMergeBase = mergeBase;
      }
    }
  }

  if (!closestMergeBase) {
    return getCommitHistory(branchHash, 1000, store);
  }

  // Return commits from branch head down to (and including) merge base
  const allCommits = getCommitHistory(branchHash, 1000, store);
  const result = [];

  for (const commit of allCommits) {
    result.push(commit);
    if (commit.hash === closestMergeBase) {
      break;
    }
  }

  return result;
}

/**
 * Check if a commit exists
 * @param {string} hash - Commit hash
 * @param {ContentAddressedStore} store - Storage instance
 * @returns {boolean} - True if commit exists
 */
function commitExists(hash, store) {
  const commit = getCommit(hash, store);
  return commit !== null;
}

/**
 * Get files from a tree object
 * @param {string} treeHash - Tree hash
 * @param {string} prefix - Path prefix for files
 * @param {ContentAddressedStore} store - Storage instance
 * @returns {Array} - Array of file entries
 */
function getTreeFiles(treeHash, prefix, store) {
  const entries = getTree(treeHash, store);
  if (!entries) return [];

  const files = [];
  for (const entry of entries) {
    if (entry.type === 'file') {
      const fileName = prefix ? `${prefix}/${entry.name}` : entry.name;
      files.push({
        name: fileName,
        hash: entry.hash,
        binary: entry.binary || false,
        mode: entry.mode,
        size: entry.size,
        type: entry.type
      });
    }
  }

  return files;
}

/**
 * Collect all objects reachable from a commit
 * @param {string} commitHash - Starting commit hash
 * @param {ContentAddressedStore} store - Storage instance
 * @returns {Set} - Set of object hashes
 */
function collectReachableObjects(commitHash, store) {
  const reachable = new Set();
  const queue = [commitHash];

  while (queue.length > 0) {
    const hash = queue.shift();
    if (!hash || reachable.has(hash)) continue;

    reachable.add(hash);

    const obj = store.getObject(hash);
    if (!obj) continue;

    if (obj.type === 'commit') {
      const commit = getCommit(hash, store);
      if (commit.tree) queue.push(commit.tree);
      if (commit.parent) queue.push(commit.parent);
    } else if (obj.type === 'tree') {
      const tree = getTree(hash, store);
      for (const entry of tree) {
        if (entry.hash) queue.push(entry.hash);
      }
    }
    // Blobs have no references
  }

  return reachable;
}

module.exports = {
  storeBlob,
  getBlob,
  storeTree,
  getTree,
  createCommit,
  getCommit,
  getCommitHistory,
  commitExists,
  getTreeFiles,
  findMergeBase,
  getOptimizedCommitHistory,
  collectReachableObjects
};