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

                sendResponse(id, 'LOAD_REPO', true, {
                    name: 'loaded-repo',
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

                const result = currentRepo.merge(data.branchName);
                const stats = await currentRepo.getStats();

                sendResponse(id, 'MERGE', true, {
                    result,
                    stats,
                    message: `Merged branch: ${data.branchName}`
                });
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

                // Return branches as array for UI compatibility
                sendResponse(id, 'LIST_BRANCHES', true, branches.map(name => ({
                    name,
                    current: name === current
                })));
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

                // Provide basic analytics
                const stats = await currentRepo.getStats();
                sendResponse(id, 'GET_STORAGE_ANALYTICS', true, {
                    totalObjects: stats.totalCommits || 0,
                    totalSize: 0,  // Not tracked in browser version
                    deduplicationSavings: 0,  // Not tracked in browser version
                    compressionRatio: 0  // Not tracked in browser version
                });
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