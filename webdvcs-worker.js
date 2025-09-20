/**
 * WebDVCS Worker - Handles VCS operations in background thread
 * Prevents UI blocking when processing large files
 */

// Import sql.js for SQLite operations (local copy to avoid CORS issues)
importScripts('sql.js/sql-wasm.js');

// Create a fake window object for the browser bundle
self.window = self;

// Import WebDVCS browser bundle with cache busting to ensure we get the latest version
// Extract version from worker URL if available, otherwise use timestamp
const workerUrl = self.location ? self.location.href : '';
const versionMatch = workerUrl.match(/[?&]v=(\d+)/);
const version = versionMatch ? versionMatch[1] : Date.now();
importScripts(`dist/webdvcs-browser.js?v=${version}`);

// Repository instance maintained in worker
let currentRepo = null;
let SQL = null;

// Get WebDVCS from the global scope (could be window.WebDVCS or self.WebDVCS)
const WebDVCS = self.WebDVCS || window.WebDVCS;

// Intercept console.log in worker to bridge debug messages to main thread (disabled in production)

// Initialize sql.js
async function initSQL() {
    if (!SQL) {
        SQL = await initSqlJs({
            locateFile: file => `sql.js/${file}`
        });

        // Make SQL.js available for BrowserDatabase (which expects window.SQL)
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

// Send debug messages to main thread console (disabled in production)
function sendDebug(message, data = null) {
    // Disabled for production - uncomment for debugging
    // self.postMessage({
    //     type: 'DEBUG',
    //     data: { message, data }
    // });
}

// Send response back to main thread
function sendResponse(id, type, success, data = null, error = null) {
    self.postMessage({
        id,
        type,
        success,
        data,
        error: error ? error.message || error : null
    });
}

// Handle messages from main thread
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
                sendProgress('Creating repository...');
                sendDebug('CREATE_REPO: Starting repository creation', { name: data.name });

                try {
                    // Ensure SQL.js is initialized before creating repository
                    await initSQL();
                    sendDebug('CREATE_REPO: SQL.js initialized');

                    // Test SQL.js functionality before proceeding
                    try {
                        const testDb = new SQL.Database();
                        testDb.exec('CREATE TABLE test (id INTEGER)');
                        testDb.exec('INSERT INTO test VALUES (1)');
                        const result = testDb.exec('SELECT * FROM test');
                        testDb.close();
                        sendDebug('CREATE_REPO: SQL.js functionality test passed', { resultCount: result.length });
                    } catch (sqlTest) {
                        sendDebug('CREATE_REPO: SQL.js functionality test failed', { error: sqlTest.message });
                        throw new Error(`SQL.js test failed: ${sqlTest.message}`);
                    }

                    // Clean up previous repository if it exists
                    if (currentRepo) {
                        sendDebug('CREATE_REPO: Cleaning up previous repository');
                        currentRepo.close();
                        currentRepo = null;
                    }

                    sendDebug('CREATE_REPO: Creating BrowserRepo instance');
                    currentRepo = new WebDVCS.BrowserRepo(data.name || 'webdvcs.sqlite');

                    sendDebug('CREATE_REPO: Calling init()');
                    await currentRepo.init();

                    sendDebug('CREATE_REPO: Repository initialized successfully');

                    if (data.name) {
                        currentRepo.repoName = data.name;
                        currentRepo.storage.setMeta('repository_name', data.name);
                        sendDebug('CREATE_REPO: Repository name set', { name: data.name });
                    }

                    sendDebug('CREATE_REPO: Getting stats');
                    const stats = currentRepo.getStats();

                    sendResponse(id, 'REPO_CREATED', true, {
                        name: data.name,
                        stats: stats
                    });

                    sendDebug('CREATE_REPO: Repository creation completed successfully');
                } catch (createError) {
                    sendDebug('CREATE_REPO: Repository creation failed', { error: createError.message, stack: createError.stack });
                    throw createError;
                }
                break;
            }

            case 'LOAD_REPO': {
                sendProgress('Loading repository...');
                const buffer = data.buffer;

                // Ensure SQL.js is initialized before loading repository
                await initSQL();

                // Clean up previous repository if it exists
                if (currentRepo) {
                    currentRepo.close();
                    currentRepo = null;
                }

                currentRepo = new WebDVCS.BrowserRepo(buffer);
                await currentRepo.init();
                sendResponse(id, 'REPO_LOADED', true, {
                    name: currentRepo.storage.getMeta('repository_name'),
                    stats: currentRepo.getStats(),
                    branches: currentRepo.listBranches(),
                    currentBranch: currentRepo.getCurrentBranch()
                });
                break;
            }

            case 'ADD_FILE': {
                // Ensure SQL.js is initialized before adding file
                await initSQL();

                const { path, content, isBinary } = data;
                sendProgress(`Adding ${path}...`);

                // Note: Removed export() calls here as they can invalidate sql.js statements
                // This was causing issues with large files

                // Convert content to Uint8Array if it's not already
                // This prevents potential encoding issues in web worker transfer
                let contentArray;
                if (content instanceof Uint8Array) {
                    contentArray = content;
                } else if (content instanceof ArrayBuffer) {
                    contentArray = new Uint8Array(content);
                } else if (typeof content === 'string') {
                    contentArray = new TextEncoder().encode(content);
                } else if (Array.isArray(content)) {
                    contentArray = new Uint8Array(content);
                } else {
                    throw new Error(`Unsupported content type for ${path}: ${typeof content}`);
                }

                const addResult = currentRepo.addFile(path, contentArray, isBinary);

                sendResponse(id, 'FILE_ADDED', true, addResult);
                break;
            }

            case 'ADD_FILES_BATCH': {
                // Ensure SQL.js is initialized before processing files
                await initSQL();

                // Check repository state before processing files
                if (!currentRepo) {
                    throw new Error('No current repository - repository was not created or was lost');
                }

                if (!currentRepo._initialized) {
                    throw new Error('Repository not initialized before file upload');
                }

                if (!currentRepo._coreRepo) {
                    throw new Error('Repository core repo is missing');
                }

                if (!currentRepo.store) {
                    throw new Error('Repository store is missing');
                }

                const { files } = data;
                const results = [];
                let addedCount = 0;
                let unchangedCount = 0;

                for (let i = 0; i < files.length; i++) {
                    const file = files[i];
                    sendProgress(`Processing ${file.path}...`, (i / files.length) * 100);

                    try {
                        // If repository is corrupted, try to recover by reinitializing
                        if (!currentRepo._initialized || !currentRepo._coreRepo || !currentRepo.store) {
                            sendProgress('Repository corrupted, attempting recovery...');
                            await currentRepo.init();
                        }

                        const batchResult = currentRepo.addFile(file.path, file.content, file.isBinary);
                        results.push(batchResult);

                        // V2 returns isNew instead of unchanged (inverted logic)
                        if (!batchResult.isNew) {
                            unchangedCount++;
                        } else {
                            addedCount++;
                        }
                    } catch (error) {
                        results.push({ error: error.message, path: file.path });
                    }
                }

                sendResponse(id, 'FILES_BATCH_ADDED', true, {
                    results,
                    addedCount,
                    unchangedCount,
                    totalCount: files.length
                });
                break;
            }

            case 'COMMIT': {
                const { message, author, email } = data;
                sendProgress('Creating commit...');

                // Note: Do NOT call export() before commit as it invalidates sql.js prepared statements!
                // This was causing the "Statement closed" error with large files

                const commitResult = currentRepo.commit(message, author, email);

                sendResponse(id, 'COMMIT_CREATED', true, commitResult);
                break;
            }

            case 'GET_STAGED_FILES': {
                const staged = currentRepo.getStagedFiles();
                sendResponse(id, 'STAGED_FILES', true, staged);
                break;
            }

            case 'GET_COMMIT_FILES': {
                const { commitHash } = data;
                const commitFiles = currentRepo.listCommitFiles(commitHash);
                sendResponse(id, 'COMMIT_FILES', true, commitFiles);
                break;
            }

            case 'GET_COMMITS': {
                const { limit } = data;
                const commits = currentRepo.log(limit);
                sendResponse(id, 'COMMITS', true, commits);
                break;
            }

            case 'GET_STATS': {
                const stats = currentRepo.getStats();
                sendResponse(id, 'STATS', true, stats);
                break;
            }

            case 'GET_STORAGE_ANALYTICS': {
                const analytics = currentRepo.getStorageAnalytics();
                sendResponse(id, 'STORAGE_ANALYTICS', true, analytics);
                break;
            }

            case 'CLEAR_STAGING': {
                currentRepo.clearStagingArea();
                sendResponse(id, 'STAGING_CLEARED', true);
                break;
            }

            case 'REMOVE_FILE': {
                const { fileName } = data;
                currentRepo.removeFile(fileName);
                sendResponse(id, 'FILE_REMOVED', true);
                break;
            }

            case 'CREATE_BRANCH': {
                const { branchName } = data;
                currentRepo.createBranch(branchName);
                sendResponse(id, 'BRANCH_CREATED', true);
                break;
            }

            case 'SWITCH_BRANCH': {
                const { targetBranch } = data;
                sendProgress(`Switching to branch ${targetBranch}...`);
                const switchResult = currentRepo.switchBranch(targetBranch);
                sendResponse(id, 'BRANCH_SWITCHED', true, switchResult);
                break;
            }

            case 'LIST_BRANCHES': {
                const branches = currentRepo.listBranches();
                sendResponse(id, 'BRANCHES', true, branches);
                break;
            }

            case 'GET_CURRENT_BRANCH': {
                const currentBranch = currentRepo.getCurrentBranch();
                sendResponse(id, 'CURRENT_BRANCH', true, { currentBranch });
                break;
            }

            case 'EXPORT_BRANCH': {
                const { branchName } = data;
                sendProgress(`Exporting branch ${branchName}...`);
                const exportData = currentRepo.exportBranchToFile(branchName);
                sendResponse(id, 'BRANCH_EXPORTED', true, exportData);
                break;
            }

            case 'IMPORT_BRANCH': {
                const { exportData } = data;
                sendProgress('Importing branch...');
                const importStats = currentRepo.importBranchFromFile(exportData);
                sendResponse(id, 'BRANCH_IMPORTED', true, importStats);
                break;
            }

            case 'DELETE_BRANCH': {
                const { branchName } = data;
                const deleted = currentRepo.deleteBranch(branchName);
                sendResponse(id, 'BRANCH_DELETED', true, { deleted });
                break;
            }

            case 'CHECKOUT': {
                const { checkoutHash } = data;
                sendProgress(`Checking out ${checkoutHash.substring(0, 8)}...`);
                const checkoutResult = currentRepo.checkout(checkoutHash);
                sendResponse(id, 'CHECKOUT_COMPLETE', true, checkoutResult);
                break;
            }

            case 'EXPORT_REPO': {
                sendProgress('Optimizing database for export...');
                // Always optimize before export to minimize size
                try {
                    currentRepo.store.db.exec('VACUUM');
                } catch (error) {
                    console.warn('VACUUM failed, continuing with export:', error);
                }

                sendProgress('Exporting repository...');
                // Export raw database data and transfer ownership to avoid copying
                const rawDbData = currentRepo.store.db.export();
                // Convert to ArrayBuffer for transfer (if not already)
                const buffer = rawDbData.buffer || rawDbData;

                // Transfer ownership to main thread to avoid memory copy
                // Note: After transfer, buffer is no longer accessible in worker
                self.postMessage({
                    id,
                    type: 'REPO_EXPORTED',
                    success: true,
                    data: { data: buffer }
                }, [buffer]); // Transfer list
                break;
            }

            case 'SET_AUTHOR': {
                const { authorName, authorEmail } = data;
                currentRepo.storage.setMeta('author_name', authorName);
                currentRepo.storage.setMeta('author_email', authorEmail || '');
                currentRepo.authorName = authorName;
                currentRepo.authorEmail = authorEmail;
                sendResponse(id, 'AUTHOR_SET', true);
                break;
            }

            case 'GET_FILE_CONTENT': {
                const { filePath } = data;
                const fileContent = currentRepo.getFile(filePath);
                sendResponse(id, 'FILE_CONTENT', true, { content: fileContent });
                break;
            }

            case 'GET_FILE_FROM_COMMIT': {
                const { fileName, commitHash } = data;
                const fileFromCommit = currentRepo.getFileFromCommit(fileName, commitHash);
                sendResponse(id, 'FILE_FROM_COMMIT', true, { content: fileFromCommit });
                break;
            }

            case 'OPTIMIZE_DATABASE': {
                sendProgress('Optimizing database...');
                const optimizationResult = currentRepo.optimizeDatabase();
                sendResponse(id, 'DATABASE_OPTIMIZED', true, optimizationResult);
                break;
            }

            case 'GET_SIZE_ANALYSIS': {
                sendProgress('Analyzing repository size...');
                const sizeAnalysis = currentRepo.getDetailedSizeAnalysis();
                sendResponse(id, 'SIZE_ANALYSIS', true, sizeAnalysis);
                break;
            }

            case 'GET_SIZE_SUMMARY': {
                const sizeSummary = currentRepo.getSizeSummary();
                sendResponse(id, 'SIZE_SUMMARY', true, sizeSummary);
                break;
            }

            case 'CLOSE_REPO': {
                if (currentRepo) {
                    currentRepo.close();
                    currentRepo = null;
                    sendResponse(id, 'REPO_CLOSED', true);
                } else {
                    sendResponse(id, 'REPO_CLOSED', true, { message: 'No repository to close' });
                }
                break;
            }

            case 'GET_MEMORY_STATS': {
                let memoryStats = null;
                if (performance && performance.memory) {
                    memoryStats = {
                        usedJSHeapSize: performance.memory.usedJSHeapSize,
                        totalJSHeapSize: performance.memory.totalJSHeapSize,
                        jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
                        usedMB: (performance.memory.usedJSHeapSize / 1048576).toFixed(2),
                        totalMB: (performance.memory.totalJSHeapSize / 1048576).toFixed(2),
                        limitMB: (performance.memory.jsHeapSizeLimit / 1048576).toFixed(2)
                    };
                }

                let repoStats = null;
                if (currentRepo) {
                    try {
                        const stats = currentRepo.getStats();
                        repoStats = {
                            files: stats.fileCount,
                            commits: stats.commitCount,
                            branches: stats.branchCount,
                            dbSizeMB: (stats.totalSize / 1048576).toFixed(2)
                        };
                    } catch (e) {
                        repoStats = { error: e.message };
                    }
                }

                sendResponse(id, 'MEMORY_STATS', true, { memory: memoryStats, repo: repoStats });
                break;
            }

            case 'TEST_DATA_INTEGRITY': {
                // Test case for debugging postMessage serialization
                const { testData } = data;
                console.log('Worker received test data:', testData);
                console.log('Worker test data constructor:', testData.constructor.name);
                console.log('Worker test data length:', testData.length);

                // Echo the data back to test serialization integrity
                sendResponse(id, 'DATA_INTEGRITY_TEST', true, { testData });
                break;
            }

            default:
                throw new Error(`Unknown message type: ${type}`);
        }
    } catch (error) {
        console.error('Worker error:', error);
        sendDebug('WORKER_ERROR: Unhandled error in message handler', {
            type: type,
            error: error.message,
            stack: error.stack
        });
        sendResponse(id, type + '_ERROR', false, null, error);
    }
});

// Report that worker is ready
self.postMessage({ type: 'WORKER_READY' });