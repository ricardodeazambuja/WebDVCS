/**
 * WebDVCS Worker - Clean Architecture Worker using Browser Core Abstraction
 * Handles VCS operations in background thread with standardized API
 */

// Import sql.js for SQLite operations
importScripts('https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.13.0/sql-wasm.js');

// Create a fake window object for the browser bundle
self.window = self;

// Import WebDVCS browser bundle with cache busting
const workerUrl = self.location ? self.location.href : '';
const versionMatch = workerUrl.match(/[?&]v=(\d+)/);
const version = versionMatch ? versionMatch[1] : Date.now();
importScripts(`dist/webdvcs-browser.js?v=${version}`);

// Repository instance maintained in worker
let currentRepo = null;
let SQL = null;

// Get WebDVCS from the global scope (standardized API from browser-entry.js)
const WebDVCS = self.WebDVCS || window.WebDVCS;

// Initialize sql.js with proper configuration
async function initSQL() {
    if (!SQL) {
        SQL = await initSqlJs({
            locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.13.0/${file}`
        });

        // Make SQL.js available globally for BrowserDatabase
        self.SQL = SQL;
        if (self.window) {
            self.window.SQL = SQL;
        }
    }
    return SQL;
}

// Send progress updates to main thread
function sendProgress(message, percentage = null) {
    self.postMessage({
        type: 'PROGRESS',
        data: { message, percentage }
    });
}

// Send debug messages (disabled in production for performance)
function sendDebug(message, data = null) {
    // Uncomment for debugging
    // self.postMessage({
    //     type: 'DEBUG',
    //     data: { message, data }
    // });
}

// Send standardized response to main thread
function sendResponse(id, type, success, data = null, error = null) {
    self.postMessage({
        id,
        type,
        success,
        data,
        error: error ? error.message || error : null
    });
}

// Create progress callback function for repository operations
function createProgressCallback() {
    return (message, percentage) => {
        sendProgress(message, percentage);
    };
}

// Preview merge function - check for conflicts without making changes
function previewMerge(repo, branchName) {
    // For now, just use the existing merge and let conflicts be caught
    // TODO: Find a way to preview without committing successful merges
    try {
        const result = repo.merge(branchName);
        return result;
    } catch (error) {
        // If it's a merge conflict error, return the conflict information
        if (error.conflicts && error.conflicts.length > 0) {
            return {
                type: 'conflict',
                conflicts: error.conflicts,
                message: error.message
            };
        }
        // Re-throw other errors
        throw error;
    }
}

// Main message handler with clean API usage
self.addEventListener('message', async (event) => {
    const { type, id, data } = event.data;

    try {
        switch (type) {
            case 'INIT': {
                await initSQL();
                sendResponse(id, 'INIT_COMPLETE', true);
                break;
            }

            case 'CREATE_REPO': {
                sendProgress('Creating repository...', 0);

                // Ensure SQL.js is initialized
                await initSQL();

                // Create new repository using standardized API
                currentRepo = await WebDVCS.BrowserRepo.create(
                    data.name || 'new-repo',
                    createProgressCallback()
                );

                const stats = await currentRepo.getStats();

                sendResponse(id, 'CREATE_REPO', true, {
                    name: data.name,
                    stats,
                    message: 'Repository created successfully'
                });
                break;
            }

            case 'LOAD_REPO': {
                sendProgress('Loading repository...', 0);

                // Load repository from uploaded file using standardized API
                currentRepo = await WebDVCS.BrowserRepo.loadFromFile(
                    data.buffer,
                    createProgressCallback()
                );

                const stats = await currentRepo.getStats();

                // Extract repository name from filename or use default
                const repoName = data.fileName ?
                    data.fileName.replace(/\.sqlite$/, '').replace(/\.webdvcs$/, '') :
                    'loaded-repo';

                sendResponse(id, 'LOAD_REPO', true, {
                    name: repoName,
                    stats,
                    message: 'Repository loaded successfully'
                });
                break;
            }

            case 'ADD_FILE': {
                if (!currentRepo) {
                    throw new Error('No repository loaded');
                }

                const result = currentRepo.add(data.path, data.content, {
                    binary: data.isBinary || false
                });

                sendResponse(id, 'ADD_FILE', true, {
                    path: data.path,
                    hash: result.hash,
                    size: data.content.length
                });
                break;
            }

            case 'ADD_FILES_BATCH': {
                if (!currentRepo) {
                    throw new Error('No repository loaded');
                }

                const results = await currentRepo.addFilesBatch(
                    data.files,
                    createProgressCallback()
                );

                sendResponse(id, 'ADD_FILES_BATCH', true, results);
                break;
            }

            case 'COMMIT': {
                if (!currentRepo) {
                    throw new Error('No repository loaded');
                }

                const result = currentRepo.commit(
                    data.message,
                    data.author,
                    data.email
                );

                sendResponse(id, 'COMMIT', true, {
                    hash: result.hash,
                    commitHash: result.hash, // UI compatibility
                    message: data.message,
                    timestamp: result.timestamp,
                    parent: result.parent
                });
                break;
            }

            case 'GET_STAGED_FILES': {
                if (!currentRepo) {
                    throw new Error('No repository loaded');
                }

                const files = await currentRepo.getStagedFiles();
                sendResponse(id, 'GET_STAGED_FILES', true, files);
                break;
            }

            case 'GET_COMMIT_FILES': {
                if (!currentRepo) {
                    throw new Error('No repository loaded');
                }

                const files = await currentRepo.getCommitFiles(data.commitHash);
                sendResponse(id, 'GET_COMMIT_FILES', true, files);
                break;
            }

            case 'GET_FILE_FROM_COMMIT': {
                if (!currentRepo) {
                    throw new Error('No repository loaded');
                }

                const files = await currentRepo.getCommitFiles(data.commitHash);
                const file = files.find(f => f.path === data.fileName || f.name === data.fileName);

                if (!file) {
                    throw new Error(`File ${data.fileName} not found in commit ${data.commitHash}`);
                }

                sendResponse(id, 'GET_FILE_FROM_COMMIT', true, { content: file.content });
                break;
            }

            case 'GET_STATUS': {
                if (!currentRepo) {
                    throw new Error('No repository loaded');
                }

                const status = currentRepo.status();
                sendResponse(id, 'GET_STATUS', true, status);
                break;
            }

            case 'GET_HISTORY': {
                if (!currentRepo) {
                    throw new Error('No repository loaded');
                }

                const history = currentRepo.getCommitHistory(data.maxCommits || 10);
                sendResponse(id, 'GET_HISTORY', true, history);
                break;
            }

            case 'GET_STATS': {
                if (!currentRepo) {
                    throw new Error('No repository loaded');
                }

                const stats = await currentRepo.getStats();
                sendResponse(id, 'GET_STATS', true, stats);
                break;
            }

            case 'GET_BRANCHES': {
                if (!currentRepo) {
                    throw new Error('No repository loaded');
                }

                const branches = currentRepo.getBranches();
                const current = currentRepo.getCurrentBranch();

                sendResponse(id, 'GET_BRANCHES', true, {
                    branches,
                    current
                });
                break;
            }

            case 'CHECKOUT': {
                if (!currentRepo) {
                    throw new Error('No repository loaded');
                }

                const result = currentRepo.checkout(data.branchName);
                const stats = await currentRepo.getStats();

                sendResponse(id, 'CHECKOUT', true, {
                    branch: data.branchName,
                    stats,
                    message: `Switched to branch: ${data.branchName}`
                });
                break;
            }

            case 'CREATE_BRANCH': {
                if (!currentRepo) {
                    throw new Error('No repository loaded');
                }

                const result = currentRepo.createBranch(
                    data.branchName,
                    data.startPoint || null
                );

                sendResponse(id, 'CREATE_BRANCH', true, {
                    branch: data.branchName,
                    message: `Created branch: ${data.branchName}`
                });
                break;
            }

            case 'DELETE_BRANCH': {
                if (!currentRepo) {
                    throw new Error('No repository loaded');
                }

                const branchName = data.branchName;
                if (!branchName) {
                    throw new Error('Branch name is required');
                }

                const result = currentRepo.deleteBranch(branchName);

                sendResponse(id, 'DELETE_BRANCH', true, {
                    branch: branchName,
                    deleted: true,
                    gcStats: result.gcStats,
                    message: `Branch '${branchName}' deleted successfully`
                });
                break;
            }

            case 'SWITCH_BRANCH': {
                if (!currentRepo) {
                    throw new Error('No repository loaded');
                }

                const result = currentRepo.checkout(data.targetBranch);
                const stats = await currentRepo.getStats();

                sendResponse(id, 'SWITCH_BRANCH', true, {
                    branch: data.targetBranch,
                    stats,
                    message: `Switched to branch: ${data.targetBranch}`
                });
                break;
            }

            case 'MERGE': {
                if (!currentRepo) {
                    throw new Error('No repository loaded');
                }

                const { branchName, options = {} } = data;

                if (options.preview) {
                    // Preview mode - check for conflicts without making changes
                    const previewResult = previewMerge(currentRepo, branchName);
                    sendResponse(id, 'MERGE', true, {
                        result: previewResult,
                        message: previewResult.type === 'conflict'
                            ? `Merge conflicts detected with branch: ${branchName}`
                            : `Preview merge of branch: ${branchName}`
                    });
                } else {
                    // Normal merge
                    const result = currentRepo.merge(branchName);
                    const stats = await currentRepo.getStats();
                    sendResponse(id, 'MERGE', true, {
                        result,
                        stats,
                        message: `Merged branch: ${branchName}`
                    });
                }
                break;
            }

            case 'DIFF': {
                if (!currentRepo) {
                    throw new Error('No repository loaded');
                }

                const diff = currentRepo.diff(
                    data.fromCommit,
                    data.toCommit || null
                );

                sendResponse(id, 'DIFF', true, diff);
                break;
            }

            case 'CLEAR_STAGING': {
                if (!currentRepo) {
                    throw new Error('No repository loaded');
                }

                const result = currentRepo.reset('mixed');

                sendResponse(id, 'CLEAR_STAGING', true, {
                    message: 'Staging area cleared successfully'
                });
                break;
            }

            case 'REMOVE_FILE': {
                if (!currentRepo) {
                    throw new Error('No repository loaded');
                }

                const fileName = data.fileName;
                if (!fileName) {
                    throw new Error('File name is required');
                }

                const result = currentRepo.removeFile(fileName);

                sendResponse(id, 'REMOVE_FILE', true, {
                    removed: result,
                    fileName: fileName,
                    message: result ? `File '${fileName}' removed from staging` : `File '${fileName}' not found or already removed`
                });
                break;
            }

            case 'RESET': {
                if (!currentRepo) {
                    throw new Error('No repository loaded');
                }

                const result = currentRepo.reset(data.mode || 'mixed');

                sendResponse(id, 'RESET', true, {
                    mode: data.mode,
                    message: `Reset staging area (${data.mode || 'mixed'} mode)`
                });
                break;
            }

            case 'EXPORT_BRANCH': {
                if (!currentRepo) {
                    throw new Error('No repository loaded');
                }

                const branchName = data.branchName;
                if (!branchName) {
                    throw new Error('Branch name is required');
                }

                // Get branch reference
                const branchRef = currentRepo.store.getRef(`refs/heads/${branchName}`);
                if (!branchRef || !branchRef.hash) {
                    throw new Error(`Branch '${branchName}' not found or has no commits`);
                }

                // Collect all objects (commits, trees, blobs) that this branch depends on
                const branchData = {
                    name: branchName,
                    head: branchRef.hash,
                    objects: {}  // Store all repository objects by hash
                };

                const exportedObjects = new Set();
                let commitCount = 0;
                let fileCount = 0;

                // Export all commits in this branch and their dependencies
                const exportCommit = (commitHash) => {
                    if (exportedObjects.has(commitHash)) return;

                    const commit = currentRepo.getCommit(commitHash);
                    if (!commit) return;

                    // Export the commit object
                    const commitData = currentRepo.store.getObjectData(commitHash);
                    if (commitData) {
                        branchData.objects[commitHash] = {
                            type: 'commit',
                            size: commitData.size,
                            data: Array.from(commitData.data)  // Convert to array for JSON
                        };
                        exportedObjects.add(commitHash);
                        commitCount++;
                    }

                    // Export the tree and its contents
                    exportTree(commit.tree);

                    // Export parent commit if it exists
                    if (commit.parent) {
                        exportCommit(commit.parent);
                    }
                };

                const exportTree = (treeHash) => {
                    if (exportedObjects.has(treeHash)) return;

                    const tree = currentRepo.getTree(treeHash);
                    if (!tree) return;

                    // Export the tree object
                    const treeData = currentRepo.store.getObjectData(treeHash);
                    if (treeData) {
                        branchData.objects[treeHash] = {
                            type: 'tree',
                            size: treeData.size,
                            data: Array.from(treeData.data)  // Convert to array for JSON
                        };
                        exportedObjects.add(treeHash);
                    }

                    // Export all blobs referenced by this tree
                    for (const entry of tree) {
                        exportBlob(entry.hash);
                    }
                };

                const exportBlob = (blobHash) => {
                    if (exportedObjects.has(blobHash)) return;

                    const blobData = currentRepo.store.getObjectData(blobHash);
                    if (blobData) {
                        branchData.objects[blobHash] = {
                            type: 'blob',
                            size: blobData.size,
                            data: Array.from(blobData.data)  // Convert to array for JSON
                        };
                        exportedObjects.add(blobHash);
                        fileCount++;
                    }
                };

                // Start the export process from the branch head
                exportCommit(branchRef.hash);

                // Create export data
                const exportJson = JSON.stringify(branchData, null, 2);
                const filename = `${branchName}-branch-export.json`;

                sendResponse(id, 'EXPORT_BRANCH', true, {
                    data: exportJson,
                    filename: filename,
                    size: exportJson.length,
                    commits: commitCount,
                    files: fileCount,
                    objects: Object.keys(branchData.objects).length,
                    message: `Branch '${branchName}' exported successfully with ${commitCount} commits and ${fileCount} files`
                });
                break;
            }

            case 'IMPORT_BRANCH': {
                if (!currentRepo) {
                    throw new Error('No repository loaded');
                }

                const exportData = data.exportData;
                if (!exportData) {
                    throw new Error('Export data is required');
                }

                let branchData;
                try {
                    // Parse the export data (it's JSON)
                    const textData = new TextDecoder().decode(exportData);
                    branchData = JSON.parse(textData);
                } catch (error) {
                    throw new Error('Invalid export data format');
                }

                if (!branchData.name || !branchData.objects) {
                    throw new Error('Invalid branch export format');
                }

                const branchName = branchData.name;

                // Check if branch already exists
                const existingRef = currentRepo.store.getRef(`refs/heads/${branchName}`);
                if (existingRef) {
                    throw new Error(`Branch '${branchName}' already exists`);
                }

                // Import all objects from the branch export
                let commitsImported = 0;
                let blobsImported = 0;
                let objectsImported = 0;

                for (const [hash, objectData] of Object.entries(branchData.objects)) {
                    try {
                        // Check if object already exists
                        const existingObject = currentRepo.store.getObjectData(hash);
                        if (existingObject) {
                            continue; // Skip if already exists
                        }

                        // Convert array back to Uint8Array
                        const data = new Uint8Array(objectData.data);

                        // Store the object in the repository using storeObject
                        const result = currentRepo.store.storeObject(data, objectData.type);
                        if (result.hash !== hash) {
                            console.warn(`Hash mismatch during import: expected ${hash}, got ${result.hash}`);
                        }
                        objectsImported++;

                        if (objectData.type === 'commit') {
                            commitsImported++;
                        } else if (objectData.type === 'blob') {
                            blobsImported++;
                        }
                    } catch (error) {
                        console.warn(`Failed to import object ${hash}:`, error);
                    }
                }

                // Create the branch reference pointing to the head commit
                if (branchData.head) {
                    currentRepo.store.setRef(`refs/heads/${branchName}`, branchData.head, 'branch');
                } else {
                    throw new Error('Branch export missing head commit hash');
                }

                sendResponse(id, 'IMPORT_BRANCH', true, {
                    branch: branchName,
                    commits_imported: commitsImported,
                    blobs_imported: blobsImported,
                    objects_imported: objectsImported,
                    message: `Branch '${branchName}' imported successfully with ${commitsImported} commits and ${blobsImported} files`
                });
                break;
            }

            case 'EXPORT_REPO': {
                if (!currentRepo) {
                    throw new Error('No repository loaded');
                }

                const dbData = currentRepo.exportDatabase();

                sendResponse(id, 'EXPORT_REPO', true, {
                    data: dbData,
                    size: dbData.byteLength,
                    message: 'Repository exported successfully'
                });
                break;
            }

            case 'SET_AUTHOR': {
                if (!currentRepo) {
                    throw new Error('No repository loaded');
                }

                const authorName = data.authorName;
                const authorEmail = data.authorEmail;

                if (!authorName) {
                    throw new Error('Author name is required');
                }

                // Store author information in repository metadata
                currentRepo.store.setMeta('author_name', authorName);
                if (authorEmail) {
                    currentRepo.store.setMeta('author_email', authorEmail);
                }

                sendResponse(id, 'SET_AUTHOR', true, {
                    authorName: authorName,
                    authorEmail: authorEmail || null,
                    message: 'Author information saved successfully'
                });
                break;
            }

            case 'CLOSE': {
                if (currentRepo) {
                    currentRepo.close();
                    currentRepo = null;
                }

                sendResponse(id, 'CLOSE', true, {
                    message: 'Repository closed'
                });
                break;
            }

            // Legacy command mappings for UI compatibility
            case 'GET_COMMITS': {
                if (!currentRepo) {
                    throw new Error('No repository loaded');
                }

                const history = currentRepo.getCommitHistory(data?.limit || 10);
                sendResponse(id, 'GET_COMMITS', true, history);
                break;
            }

            case 'LIST_BRANCHES': {
                if (!currentRepo) {
                    throw new Error('No repository loaded');
                }

                const branches = currentRepo.getBranches();
                const current = currentRepo.getCurrentBranch();

                // Return branches as array with commit info for UI compatibility
                sendResponse(id, 'LIST_BRANCHES', true, branches.map(name => {
                    // Get the latest commit hash for this branch
                    const branchRef = currentRepo.store.getRef(`refs/heads/${name}`);
                    const hash = branchRef ? branchRef.hash : null;

                    return {
                        name,
                        current: name === current,
                        hash: hash
                    };
                }));
                break;
            }

            case 'GET_CURRENT_BRANCH': {
                if (!currentRepo) {
                    throw new Error('No repository loaded');
                }

                const branch = currentRepo.getCurrentBranch();
                sendResponse(id, 'GET_CURRENT_BRANCH', true, { branch });
                break;
            }

            case 'GET_STORAGE_ANALYTICS': {
                if (!currentRepo) {
                    throw new Error('No repository loaded');
                }

                // Get real analytics from repository
                const analytics = currentRepo.getStorageAnalytics();
                sendResponse(id, 'GET_STORAGE_ANALYTICS', true, analytics);
                break;
            }

            default: {
                sendResponse(id, 'ERROR', false, null, `Unknown command: ${type}`);
                break;
            }
        }
    } catch (error) {
        console.error(`Worker error handling ${type}:`, error);
        sendResponse(id, type, false, null, error.message || error);
    }
});

// Notify main thread that worker is ready
self.postMessage({ type: 'WORKER_READY' });