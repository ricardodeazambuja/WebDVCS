        // WorkerWrapper class to proxy all operations to Web Worker
        class WorkerWrapper {
            constructor() {
                this.worker = null;
                this.messageId = 0;
                this.pendingMessages = new Map();
                this.progressCallback = null;
                this.repoName = null;
                this.authorName = null;
                this.authorEmail = null;
            }

            async init() {
                return new Promise((resolve, reject) => {
                    this.worker = new Worker(`webdvcs-worker.js?v=${Date.now()}`);

                    this.worker.onmessage = (event) => {
                        const { type, id, success, data, error } = event.data;

                        if (type === 'WORKER_READY') {
                            this.sendMessage('INIT').then(resolve).catch(reject);
                            return;
                        }

                        if (type === 'PROGRESS') {
                            if (this.progressCallback) {
                                this.progressCallback(data.message, data.percentage);
                            }
                            return;
                        }

                        if (type === 'DEBUG') {
                            console.log('🔗 ' + data.message);
                            if (data.data) {
                                console.log('   📋 Data:', data.data);
                            }
                            return;
                        }

                        const pending = this.pendingMessages.get(id);
                        if (pending) {
                            this.pendingMessages.delete(id);
                            if (success) {
                                pending.resolve(data);
                            } else {
                                pending.reject(new Error(error || 'Operation failed'));
                            }
                        }
                    };

                    this.worker.onerror = (error) => {
                        console.error('Worker error:', error);
                        reject(error);
                    };
                });
            }

            sendMessage(type, data = {}) {
                return new Promise((resolve, reject) => {
                    const id = ++this.messageId;
                    this.pendingMessages.set(id, { resolve, reject });
                    this.worker.postMessage({ type, id, data });
                });
            }

            setProgressCallback(callback) {
                this.progressCallback = callback;
            }

            async createRepository(name) {
                this.repoName = name;
                const result = await this.sendMessage('CREATE_REPO', { name });
                return result;
            }

            async loadRepository(buffer, fileName = null) {
                const result = await this.sendMessage('LOAD_REPO', { buffer, fileName });
                this.repoName = result.name;
                return result;
            }

            async addFile(path, content, isBinary) {
                return this.sendMessage('ADD_FILE', { path, content, isBinary });
            }

            async addFilesBatch(files) {
                return this.sendMessage('ADD_FILES_BATCH', { files });
            }

            async commit(message, author, email) {
                return this.sendMessage('COMMIT', { message, author, email });
            }

            async getStagedFiles() {
                return this.sendMessage('GET_STAGED_FILES');
            }

            async getCommitFiles(commitHash) {
                return this.sendMessage('GET_COMMIT_FILES', { commitHash });
            }

            async getCommits(limit = 10) {
                return this.sendMessage('GET_COMMITS', { limit });
            }

            async diffCommits(fromCommit, toCommit) {
                return this.sendMessage('DIFF', { fromCommit, toCommit });
            }

            async getStats() {
                return this.sendMessage('GET_STATS');
            }

            async getStorageAnalytics() {
                return this.sendMessage('GET_STORAGE_ANALYTICS');
            }

            async clearStagingArea() {
                return this.sendMessage('CLEAR_STAGING');
            }

            async removeFile(fileName) {
                return this.sendMessage('REMOVE_FILE', { fileName });
            }

            async createBranch(branchName) {
                return this.sendMessage('CREATE_BRANCH', { branchName });
            }

            async switchBranch(targetBranch) {
                return this.sendMessage('SWITCH_BRANCH', { targetBranch });
            }

            async deleteBranch(branchName) {
                return this.sendMessage('DELETE_BRANCH', { branchName });
            }

            async merge(branchName, options = {}) {
                return this.sendMessage('MERGE', { branchName, options });
            }

            async listBranches() {
                return this.sendMessage('LIST_BRANCHES');
            }

            async getCurrentBranch() {
                const result = await this.sendMessage('GET_CURRENT_BRANCH');
                return result.branch;
            }

            async deleteBranch(branchName) {
                return this.sendMessage('DELETE_BRANCH', { branchName });
            }

            async exportBranch(branchName) {
                return this.sendMessage('EXPORT_BRANCH', { branchName });
            }

            async importBranch(exportData) {
                return this.sendMessage('IMPORT_BRANCH', { exportData });
            }

            async checkout(checkoutHash) {
                return this.sendMessage('CHECKOUT', { checkoutHash });
            }

            async exportRepository() {
                const result = await this.sendMessage('EXPORT_REPO');
                return result.data;
            }

            async setAuthor(authorName, authorEmail) {
                this.authorName = authorName;
                this.authorEmail = authorEmail;
                return this.sendMessage('SET_AUTHOR', { authorName, authorEmail });
            }

            async getFileContent(filePath) {
                // First try to get from staged files (which already include content)
                try {
                    const stagedFiles = await this.getStagedFiles();
                    const stagedFile = stagedFiles.find(f => f.path === filePath || f.name === filePath);
                    if (stagedFile && stagedFile.content) {
                        return stagedFile.content;
                    }
                } catch (error) {
                    console.warn('Could not get from staged files:', error);
                }

                // Fallback: try to get from latest commit
                try {
                    const history = await this.getCommitHistory(1);
                    if (history.length > 0) {
                        const commitFiles = await this.getCommitFiles(history[0].hash);
                        const commitFile = commitFiles.find(f => f.path === filePath || f.name === filePath);
                        if (commitFile && commitFile.content) {
                            return commitFile.content;
                        }
                    }
                } catch (error) {
                    console.warn('Could not get from commit files:', error);
                }

                throw new Error(`File not found: ${filePath}`);
            }

            async getFileFromCommit(fileName, commitHash) {
                const result = await this.sendMessage('GET_FILE_FROM_COMMIT', { fileName, commitHash });
                return result.content;
            }

            // Compatibility properties
            get storage() {
                return {
                    getMeta: (key) => {
                        if (key === 'author_name') return this.authorName;
                        if (key === 'author_email') return this.authorEmail;
                        if (key === 'repository_name') return this.repoName;
                        return null;
                    },
                    setMeta: (key, value) => {
                        if (key === 'author_name') this.authorName = value;
                        if (key === 'author_email') this.authorEmail = value;
                        if (key === 'repository_name') this.repoName = value;
                    }
                };
            }
        }

        // Global state (using WorkerWrapper instead of direct repo)
        let currentRepo = null;

        // Utility function to normalize merge result structure from worker responses
        function normalizeMergeResult(workerResponse) {
            // Worker returns: { result: {...}, message: "..." }
            // We need: { success, type, commitHash, conflicts, message }
            const result = (workerResponse && workerResponse.result) || workerResponse || {};

            return {
                success: result.success !== undefined ? result.success : (result.type !== 'conflict'),
                type: result.type || 'unknown',
                commitHash: result.commitHash || null,
                conflicts: result.conflicts || [],
                message: (workerResponse && workerResponse.message) || result.message || 'No details available'
            };
        }

        // DOM elements
        const elements = {
            repoStatus: document.getElementById('repoStatus'),
            statusIcon: document.getElementById('statusIcon'),
            repoName: document.getElementById('repoName'),
            authorName: document.getElementById('authorName'),
            authorEmail: document.getElementById('authorEmail'),
            saveAuthorButton: document.getElementById('saveAuthorButton'),
            createRepoButton: document.getElementById('createRepoButton'),
            downloadRepoButton: document.getElementById('downloadRepoButton'),
            uploadRepo: document.getElementById('uploadRepo'),
            repoInfo: document.getElementById('repoInfo'),
            commitCount: document.getElementById('commitCount'),
            fileCount: document.getElementById('fileCount'),
            branchCount: document.getElementById('branchCount'),
            // File Explorer
            stagedTab: document.getElementById('stagedTab'),
            committedTab: document.getElementById('committedTab'),
            stagedView: document.getElementById('stagedView'),
            committedView: document.getElementById('committedView'),
            stagedTree: document.getElementById('stagedTree'),
            committedTree: document.getElementById('committedTree'),
            stagedSearch: document.getElementById('stagedSearch'),
            committedSearch: document.getElementById('committedSearch'),
            commitSelect: document.getElementById('commitSelect'),
            refreshStaged: document.getElementById('refreshStaged'),
            clearStaged: document.getElementById('clearStaged'),
            refreshCommitted: document.getElementById('refreshCommitted'),
            commitMessage: document.getElementById('commitMessage'),
            commitButton: document.getElementById('commitButton'),
            commitHistory: document.getElementById('commitHistory'),
            branchName: document.getElementById('branchName'),
            createBranchButton: document.getElementById('createBranchButton'),
            branchSelect: document.getElementById('branchSelect'),
            switchBranchButton: document.getElementById('switchBranchButton'),
            deleteBranchSelect: document.getElementById('deleteBranchSelect'),
            deleteBranchButton: document.getElementById('deleteBranchButton'),
            branchItems: document.getElementById('branchItems'),
            currentBranch: document.getElementById('currentBranch'),
            exportBranchSelect: document.getElementById('exportBranchSelect'),
            exportBranchButton: document.getElementById('exportBranchButton'),
            importBranchFile: document.getElementById('importBranchFile'),
            importBranchButton: document.getElementById('importBranchButton'),
            progressIndicator: document.getElementById('progressIndicator'),
            progressIcon: document.getElementById('progressIcon'),
            progressMessage: document.getElementById('progressMessage')
        };

        // Initialize application
        async function initApp() {
            try {
                updateStatus('⏳ Initializing Web Worker...', 'info');

                if (!window.WebDVCS) {
                    throw new Error('WebDVCS not loaded');
                }

                // Initialize the worker wrapper for non-blocking operations
                currentRepo = new WorkerWrapper();
                await currentRepo.init();

                // Expose to global scope for testing and UI access
                window.currentRepo = currentRepo;

                // Set up progress callback
                currentRepo.setProgressCallback((message, percentage) => {
                    if (percentage !== null && percentage > 0) {
                        showProgress(`${message} (${Math.round(percentage)}%)`);
                    } else {
                        showProgress(message);
                    }
                });

                setupEventListeners();
                updateStatus('✅ Ready! Create or load a repository to begin.', 'success');

            } catch (error) {
                console.error('Failed to initialize:', error);
                updateStatus(`❌ Failed to initialize: ${error.message}`, 'error');
            }
        }

        // Setup event listeners
        function setupEventListeners() {
            // Repository management
            if (elements.createRepoButton) {
                elements.createRepoButton.addEventListener('click', createNewRepository);
            } else {
                console.error('[ERROR] setupEventListeners: createRepoButton element not found!');
            }
            elements.uploadRepo.addEventListener('change', uploadRepository); // Auto-upload when file is selected
            elements.downloadRepoButton.addEventListener('click', downloadRepository);
            elements.saveAuthorButton.addEventListener('click', saveAuthorInfo);


            // Commits
            elements.commitButton.addEventListener('click', createCommit);

            // Diff viewer
            const openDiffViewerButton = document.getElementById('openDiffViewerButton');
            if (openDiffViewerButton) {
                openDiffViewerButton.addEventListener('click', openDiffViewer);
            }

            // Branches
            elements.createBranchButton.addEventListener('click', createBranch);
            elements.switchBranchButton.addEventListener('click', switchBranch);
            elements.deleteBranchButton.addEventListener('click', deleteBranch);
            elements.exportBranchButton.addEventListener('click', exportBranch);
            elements.importBranchButton.addEventListener('click', importBranch);

            // File explorer
            elements.stagedTab.addEventListener('click', () => switchExplorerTab('staged'));
            elements.committedTab.addEventListener('click', () => switchExplorerTab('committed'));
            elements.refreshStaged.addEventListener('click', refreshStagedFiles);
            elements.clearStaged.addEventListener('click', clearStagedFiles);
            elements.refreshCommitted.addEventListener('click', refreshCommittedFiles);
            elements.commitSelect.addEventListener('change', loadCommittedFiles);

            // Unstaging functionality
            const unstageAllButton = document.getElementById('unstageAllButton');
            if (unstageAllButton) {
                unstageAllButton.addEventListener('click', unstageAllFiles);
            }

            // File deletion functionality
            const deleteAllStagedButton = document.getElementById('deleteAllStagedButton');
            if (deleteAllStagedButton) {
                deleteAllStagedButton.addEventListener('click', deleteAllStagedFiles);
            }

            // Repository status
            const refreshStatusButton = document.getElementById('refreshStatusButton');
            if (refreshStatusButton) {
                refreshStatusButton.addEventListener('click', refreshStatus);
            }

            // Enhanced commit log
            const refreshCommitsButton = document.getElementById('refreshCommitsButton');
            const loadMoreCommitsButton = document.getElementById('loadMoreCommitsButton');
            const commitPageSize = document.getElementById('commitPageSize');

            if (refreshCommitsButton) {
                refreshCommitsButton.addEventListener('click', refreshCommits);
            }
            if (loadMoreCommitsButton) {
                loadMoreCommitsButton.addEventListener('click', loadMoreCommits);
            }
            if (commitPageSize) {
                commitPageSize.addEventListener('change', refreshCommits);
            }

            // Repository analytics
            const refreshAnalyticsButton = document.getElementById('refreshAnalyticsButton');
            if (refreshAnalyticsButton) {
                refreshAnalyticsButton.addEventListener('click', refreshAnalytics);
            }

            // Time travel controls
            const returnToHeadButton = document.getElementById('returnToHeadButton');
            if (returnToHeadButton) {
                returnToHeadButton.addEventListener('click', returnToHead);
            }

            // Merge operations
            const previewMergeButton = document.getElementById('previewMergeButton');
            const executeMergeButton = document.getElementById('executeMergeButton');
            const abortMergeButton = document.getElementById('abortMergeButton');
            const resolveConflictsButton = document.getElementById('resolveConflictsButton');

            if (previewMergeButton) {
                previewMergeButton.addEventListener('click', previewMerge);
            }
            if (executeMergeButton) {
                executeMergeButton.addEventListener('click', executeMerge);
            }
            if (abortMergeButton) {
                abortMergeButton.addEventListener('click', abortMerge);
            }
            if (resolveConflictsButton) {
                resolveConflictsButton.addEventListener('click', resolveConflicts);
            }

            document.getElementById('uploadFile').addEventListener('change', handleFileUpload);
            document.getElementById('uploadDirectory').addEventListener('change', handleDirectoryUpload);
        }

        // Repository management functions
        async function createNewRepository() {
            try {
                const repoName = elements.repoName.value.trim() || 'webdvcs-repo';
                showProgress(`Creating repository: ${repoName}...`);

                if (!currentRepo) {
                    throw new Error('Worker not initialized - currentRepo is null');
                }

                await currentRepo.createRepository(repoName);

                // Load saved author info if exists
                const savedAuthor = currentRepo.storage.getMeta('author_name');
                const savedEmail = currentRepo.storage.getMeta('author_email');
                if (savedAuthor) elements.authorName.value = savedAuthor;
                if (savedEmail) elements.authorEmail.value = savedEmail;


                updateStatus(`✅ Repository '${repoName}' created successfully!`, 'success');
                elements.downloadRepoButton.disabled = false;
                elements.repoInfo.classList.remove('d-none');

                await refreshAll();
                hideProgress();

            } catch (error) {
                console.error('Failed to create repository:', error);
                updateStatus(`❌ Failed to create repository: ${error.message}`, 'error');
                hideProgress();
            }
        }

        async function uploadRepository() {
            const file = elements.uploadRepo.files[0];
            if (!file) {
                updateStatus('❌ Please select a repository file to upload.', 'error');
                return;
            }

            try {
                showProgress('Loading repository...');
                const arrayBuffer = await file.arrayBuffer();
                const data = new Uint8Array(arrayBuffer);

                // Pass filename to worker for proper repo naming
                await currentRepo.loadRepository(data, file.name);

                // Load repository name and author info
                const repoName = currentRepo.storage.getMeta('repository_name');
                if (repoName) {
                    currentRepo.repoName = repoName;
                    elements.repoName.value = repoName;
                }

                const savedAuthor = currentRepo.storage.getMeta('author_name');
                const savedEmail = currentRepo.storage.getMeta('author_email');
                if (savedAuthor) elements.authorName.value = savedAuthor;
                if (savedEmail) elements.authorEmail.value = savedEmail;

                updateStatus(`✅ Repository loaded: ${repoName || file.name}`, 'success');
                elements.downloadRepoButton.disabled = false;
                elements.repoInfo.classList.remove('d-none');

                await refreshAll();
                hideProgress();

            } catch (error) {
                console.error('Failed to load repository:', error);
                updateStatus(`❌ Failed to load repository: ${error.message}`, 'error');
                hideProgress();
            }
        }

        function saveAuthorInfo() {
            if (!currentRepo) {
                updateStatus('❌ No repository loaded.', 'error');
                return;
            }

            const authorName = elements.authorName.value.trim();
            const authorEmail = elements.authorEmail.value.trim();

            if (!authorName) {
                updateStatus('❌ Author name is required.', 'error');
                return;
            }

            currentRepo.storage.setMeta('author_name', authorName);
            currentRepo.storage.setMeta('author_email', authorEmail);
            currentRepo.authorName = authorName;
            currentRepo.authorEmail = authorEmail;

            updateStatus(`✅ Author info saved: ${authorName}${authorEmail ? ' <' + authorEmail + '>' : ''}`, 'success');
        }

        async function downloadRepository() {
            if (!currentRepo) {
                updateStatus('❌ No repository to download.', 'error');
                return;
            }

            try {
                showProgress('Preparing repository for download...');
                const data = await currentRepo.exportRepository();
                const blob = new Blob([data], { type: 'application/x-sqlite3' });
                const url = URL.createObjectURL(blob);

                const a = document.createElement('a');
                a.href = url;
                // Use repository name for filename
                const repoName = currentRepo.storage.getMeta('repository_name') || elements.repoName.value.trim() || 'webdvcs-repo';
                a.download = `${repoName}.sqlite`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);

                updateStatus('✅ Repository downloaded successfully!', 'success');
                hideProgress();
            } catch (error) {
                console.error('Failed to download repository:', error);
                updateStatus(`❌ Failed to download repository: ${error.message}`, 'error');
                hideProgress();
            }
        }


        // Commit functions
        async function createCommit() {
            const message = elements.commitMessage.value.trim();
            if (!message) {
                updateStatus('❌ Please enter a commit message.', 'error');
                return;
            }

            if (!currentRepo) {
                updateStatus('❌ No repository loaded.', 'error');
                return;
            }

            try {
                showProgress('Creating commit...');
                const author = currentRepo.authorName || currentRepo.storage.getMeta('author_name') || 'Browser User';
                const email = currentRepo.authorEmail || currentRepo.storage.getMeta('author_email') || '';
                const result = await currentRepo.commit(message, author, email);
                elements.commitMessage.value = '';

                updateStatus(`✅ Created commit ${result.commitHash.substring(0, 8)}`, 'success');
                await refreshAll();
                hideProgress();

            } catch (error) {
                console.error('Failed to create commit:', error);
                hideProgress();

                // Show user-friendly error messages
                if (error.message.includes('Nothing to commit')) {
                    updateStatus('⚠️ Nothing to commit - please add files to the staging area first', 'warning');
                    alert('Nothing to commit! Please add files to the staging area first.');
                } else {
                    updateStatus(`❌ Failed to create commit: ${error.message}`, 'error');
                }
            }
        }

        // Branch functions
        async function createBranch() {
            const name = elements.branchName.value.trim();
            if (!name) {
                updateStatus('❌ Please enter a branch name.', 'error');
                return;
            }

            if (!currentRepo) {
                updateStatus('❌ No repository loaded.', 'error');
                return;
            }

            try {
                showProgress(`Creating branch '${name}'...`);
                await currentRepo.createBranch(name);
                elements.branchName.value = '';

                updateStatus(`✅ Created branch '${name}'`, 'success');
                await refreshBranches();
                await refreshStats();
                hideProgress();

            } catch (error) {
                console.error('Failed to create branch:', error);
                updateStatus(`❌ Failed to create branch: ${error.message}`, 'error');
                hideProgress();
            }
        }

        async function switchBranch() {
            const name = elements.branchSelect.value;
            if (!name) {
                updateStatus('❌ Please select a branch.', 'error');
                return;
            }

            if (!currentRepo) {
                updateStatus('❌ No repository loaded.', 'error');
                return;
            }

            try {
                showProgress(`Switching to branch '${name}'...`);
                const result = await currentRepo.switchBranch(name);
                updateStatus(`✅ Switched to branch '${result.branch || name}'`, 'success');
                await refreshAll();
                hideProgress();

            } catch (error) {
                console.error('Failed to switch branch:', error);
                updateStatus(`❌ Failed to switch branch: ${error.message}`, 'error');
                hideProgress();
            }
        }

        async function deleteBranch() {
            const name = elements.deleteBranchSelect.value;
            if (!name) {
                updateStatus('❌ Please select a branch to delete.', 'error');
                return;
            }

            if (!currentRepo) {
                updateStatus('❌ No repository loaded.', 'error');
                return;
            }

            // Confirm deletion
            if (!confirm(`Are you sure you want to delete branch '${name}'? This action cannot be undone.`)) {
                return;
            }

            try {
                showProgress(`Deleting branch '${name}'...`);
                const result = await currentRepo.deleteBranch(name);
                updateStatus(`✅ Branch '${name}' deleted successfully`, 'success');
                await refreshAll();
                hideProgress();

            } catch (error) {
                console.error('Failed to delete branch:', error);
                updateStatus(`❌ Failed to delete branch: ${error.message}`, 'error');
                hideProgress();
            }
        }

        // Branch export/import functions
        async function exportBranch() {
            const branchName = elements.exportBranchSelect.value;
            if (!branchName) {
                updateStatus('❌ Please select a branch to export.', 'error');
                return;
            }

            if (!currentRepo) {
                updateStatus('❌ No repository loaded.', 'error');
                return;
            }

            try {
                showProgress(`Exporting branch '${branchName}'...`);
                const exportData = await currentRepo.exportBranch(branchName);

                // Create download
                const blob = new Blob([exportData.data], { type: 'application/json' });
                const url = URL.createObjectURL(blob);

                const a = document.createElement('a');
                a.href = url;
                a.download = exportData.filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);

                updateStatus(`✅ Branch '${branchName}' exported successfully!`, 'success');
                hideProgress();

            } catch (error) {
                console.error('Failed to export branch:', error);
                updateStatus(`❌ Failed to export branch: ${error.message}`, 'error');
                hideProgress();
            }
        }

        async function importBranch() {
            const file = elements.importBranchFile.files[0];
            if (!file) {
                updateStatus('❌ Please select a branch file to import.', 'error');
                return;
            }

            if (!currentRepo) {
                updateStatus('❌ No repository loaded.', 'error');
                return;
            }

            try {
                showProgress('Importing branch...');
                const fileContent = await file.arrayBuffer();
                const importStats = await currentRepo.importBranch(new Uint8Array(fileContent));

                updateStatus(`✅ Branch imported: ${importStats.commits_imported} commits, ${importStats.blobs_imported} blobs`, 'success');

                // Clear file input
                elements.importBranchFile.value = '';

                // Refresh UI
                await refreshAll();
                hideProgress();

            } catch (error) {
                console.error('Failed to import branch:', error);
                updateStatus(`❌ Failed to import branch: ${error.message}`, 'error');
                hideProgress();
            }
        }

        // UI update functions
        function updateStatus(message, type = 'info') {
            // Update the legacy status (for compatibility)
            elements.repoStatus.textContent = message;
            elements.repoStatus.className = `status ${type}`;

            const icons = {
                info: 'ℹ️',
                success: '✅',
                error: '❌',
                warning: '⚠️'
            };
            elements.statusIcon.textContent = icons[type] || 'ℹ️';

            // Show floating notification
            showFloatingNotification(message, type);
        }

        function showFloatingNotification(message, type = 'info') {
            const icons = {
                info: 'ℹ️',
                success: '✅',
                error: '❌',
                warning: '⚠️'
            };

            // Remove any existing notifications
            const existing = document.querySelectorAll('.floating-notification');
            existing.forEach(notif => notif.remove());

            // Create new notification
            const notification = document.createElement('div');
            notification.className = `floating-notification ${type}`;
            notification.innerHTML = `
                <div style="display: flex; align-items: center;">
                    <span>${message}</span>
                </div>
            `;

            // Add to page
            document.body.appendChild(notification);

            // Trigger animation
            setTimeout(() => notification.classList.add('show'), 100);

            // Auto-remove after delay (longer for errors)
            const delay = type === 'error' ? 5000 : 3000;
            setTimeout(() => {
                notification.classList.remove('show');
                setTimeout(() => notification.remove(), 300);
            }, delay);
        }

        let progressTimeout = null;

        function showProgress(message) {
            elements.progressMessage.textContent = message;
            elements.progressIcon.innerHTML = '🔄'; // spinning emoji
            elements.progressIcon.className = 'spinner';
            elements.progressIndicator.classList.add('progress-pulse');
            elements.progressIndicator.classList.remove('d-none');

            // Auto-hide after 30 seconds to prevent stuck progress indicators
            if (progressTimeout) clearTimeout(progressTimeout);
            progressTimeout = setTimeout(() => {
                console.warn('Progress indicator auto-hidden after 30s timeout');
                hideProgress();
            }, 30000);
        }

        function hideProgress() {
            if (progressTimeout) {
                clearTimeout(progressTimeout);
                progressTimeout = null;
            }
            elements.progressIndicator.classList.add('d-none');
            elements.progressIndicator.classList.remove('progress-pulse');
            elements.progressIcon.className = '';
        }

        async function refreshAll() {
            if (!currentRepo) return;

            try {
                // Show status section when repository is loaded
                const statusSection = document.getElementById('statusSection');
                if (statusSection) {
                    statusSection.style.display = 'block';
                }

                await Promise.all([
                    refreshStats(),
                    refreshCommits(),
                    refreshBranches(),
                    refreshStagedFiles(),
                    refreshCommittedFiles(),
                    refreshStatus(),
                    refreshAnalytics()
                ]);
            } catch (error) {
                console.error('Failed to refresh UI:', error);
            }
        }

        async function refreshStats() {
            if (!currentRepo) return;

            try {
                const stats = await currentRepo.getStats();
                elements.commitCount.textContent = stats.commits || 0;
                elements.fileCount.textContent = stats.files || 0;
                elements.branchCount.textContent = stats.branches || 1;
            } catch (error) {
                console.error('Failed to refresh stats:', error);
            }
        }

        // Enhanced commit log state
        let commitLogState = {
            currentPage: 0,
            pageSize: 10,
            totalCommits: 0,
            allCommits: []
        };

        async function refreshCommits() {
            if (!currentRepo) return;

            try {
                // Reset state for fresh load
                commitLogState.currentPage = 0;
                commitLogState.allCommits = [];

                // Get page size from selector
                const pageSizeSelect = document.getElementById('commitPageSize');
                if (pageSizeSelect) {
                    commitLogState.pageSize = parseInt(pageSizeSelect.value) || 10;
                }

                await loadCommits();

            } catch (error) {
                console.error('Failed to refresh commits:', error);
                elements.commitHistory.innerHTML = '<div class="text-center text-muted">Error loading commits</div>';
            }
        }

        async function loadCommits() {
            if (!currentRepo) return;

            try {
                // Get commits for current page
                const startIndex = commitLogState.currentPage * commitLogState.pageSize;
                const commits = await currentRepo.getCommits(commitLogState.pageSize * (commitLogState.currentPage + 1));

                if (commits.length === 0 && commitLogState.currentPage === 0) {
                    elements.commitHistory.innerHTML = '<div class="text-center text-muted">No commits yet</div>';
                    document.getElementById('commitPagination').style.display = 'none';
                    return;
                }

                // Add new commits to our state
                commitLogState.allCommits.push(...commits);

                // Render all commits
                renderCommits();

                // Update pagination
                updateCommitPagination(commits.length);

            } catch (error) {
                console.error('Failed to load commits:', error);
                updateStatus('❌ Failed to load commits', 'error');
            }
        }

        function renderCommits() {
            if (commitLogState.allCommits.length === 0) {
                elements.commitHistory.innerHTML = '<div class="text-center text-muted">No commits yet</div>';
                return;
            }

            elements.commitHistory.innerHTML = commitLogState.allCommits.map((commit, index) => `
                <div class="commit-item" onclick="showCommitDetails('${commit.hash}')" data-commit-hash="${commit.hash}">
                    <div class="commit-hash">📝 ${commit.hash.substring(0, 8)}</div>
                    <div class="commit-message">${escapeHtml(commit.message)}</div>
                    <div class="commit-meta">
                        <div class="commit-author">
                            👤 ${escapeHtml(commit.author || 'Unknown')}
                        </div>
                        <div class="commit-date">
                            🕒 ${new Date(commit.timestamp * 1000).toLocaleString()}
                        </div>
                    </div>
                </div>
            `).join('');
        }

        function updateCommitPagination(lastLoadCount) {
            const pagination = document.getElementById('commitPagination');
            const pageInfo = document.getElementById('commitPageInfo');
            const loadMoreButton = document.getElementById('loadMoreCommitsButton');

            if (!pagination || !pageInfo || !loadMoreButton) return;

            const totalShown = commitLogState.allCommits.length;
            pageInfo.textContent = `Showing ${totalShown} commits`;

            // Show pagination if we have commits
            if (totalShown > 0) {
                pagination.style.display = 'flex';

                // Hide load more button if last load returned fewer commits than page size
                if (lastLoadCount < commitLogState.pageSize) {
                    loadMoreButton.style.display = 'none';
                } else {
                    loadMoreButton.style.display = 'block';
                }
            } else {
                pagination.style.display = 'none';
            }
        }

        async function loadMoreCommits() {
            commitLogState.currentPage++;
            await loadCommits();
        }

        // === Commit Details Modal Functions ===
        async function showCommitDetails(commitHash) {
            if (!currentRepo || !commitHash) {
                updateStatus('❌ Invalid commit hash.', 'error');
                return;
            }

            try {
                showProgress('Loading commit details...');

                // Get commit details
                const commits = await currentRepo.getCommits(1000); // Get enough commits to find this one
                const commit = commits.find(c => c.hash === commitHash);

                if (!commit) {
                    updateStatus('❌ Commit not found.', 'error');
                    hideProgress();
                    return;
                }

                // Populate commit details modal
                document.getElementById('commitDetailHash').textContent = commit.hash;
                document.getElementById('commitDetailAuthor').textContent = commit.author || 'Unknown';
                document.getElementById('commitDetailDate').textContent = new Date(commit.timestamp * 1000).toLocaleString();
                document.getElementById('commitDetailBranch').textContent = await currentRepo.getCurrentBranch() || 'main';
                document.getElementById('commitDetailMessage').textContent = commit.message || 'No commit message';

                // Get files changed in this commit
                await loadCommitFiles(commitHash);

                // Set up diff button
                const viewDiffButton = document.getElementById('viewCommitDiffButton');
                if (viewDiffButton) {
                    viewDiffButton.onclick = () => {
                        closeModal('commitDetailsModal');
                        openDiffViewerForCommit(commitHash);
                    };
                }

                // Set up checkout button
                const checkoutButton = document.getElementById('checkoutCommitButton');
                if (checkoutButton) {
                    checkoutButton.onclick = () => {
                        closeModal('commitDetailsModal');
                        checkoutCommit(commitHash);
                    };
                }

                // Open the modal
                openModal('commitDetailsModal');
                hideProgress();

            } catch (error) {
                console.error('Failed to show commit details:', error);
                updateStatus(`❌ Failed to load commit details: ${error.message}`, 'error');
                hideProgress();
            }
        }

        async function loadCommitFiles(commitHash) {
            try {
                // Get the commit details including file changes
                const commits = await currentRepo.getCommits(1000);
                const commitIndex = commits.findIndex(c => c.hash === commitHash);

                if (commitIndex === -1) {
                    document.getElementById('commitDetailFiles').innerHTML = '<div class="empty-state">Commit not found</div>';
                    return;
                }

                // For the first commit, show all files as added
                if (commitIndex === commits.length - 1) {
                    // This is the initial commit - get all files in this commit
                    const files = await currentRepo.getCommitFiles(commitHash);
                    displayCommitFiles(files.map(file => ({ file, type: 'added' })));
                } else {
                    // Get the previous commit and diff
                    const previousCommit = commits[commitIndex + 1];
                    const diff = await currentRepo.diffCommits(previousCommit.hash, commitHash);
                    displayCommitFiles(diff);
                }

            } catch (error) {
                console.error('Failed to load commit files:', error);
                document.getElementById('commitDetailFiles').innerHTML = '<div class="empty-state">Error loading files</div>';
            }
        }

        function displayCommitFiles(fileChanges) {
            const filesContainer = document.getElementById('commitDetailFiles');

            if (!fileChanges || fileChanges.length === 0) {
                filesContainer.innerHTML = '<div class="empty-state">No files changed in this commit</div>';
                return;
            }

            const filesHtml = fileChanges.map(change => {
                const fileName = change.file.name || change.file.path || change.file;
                const changeType = change.type || 'modified';
                const statusClass = changeType === 'added' ? 'added' :
                                   changeType === 'deleted' ? 'deleted' : 'modified';

                return `
                    <div class="commit-file-item">
                        <span class="commit-file-name">${escapeHtml(fileName)}</span>
                        <div class="commit-file-status">
                            <span class="commit-file-status-indicator ${statusClass}">
                                ${changeType}
                            </span>
                            ${change.additions ? `<span class="commit-stat additions">+${change.additions}</span>` : ''}
                            ${change.deletions ? `<span class="commit-stat deletions">-${change.deletions}</span>` : ''}
                        </div>
                    </div>
                `;
            }).join('');

            filesContainer.innerHTML = filesHtml;
        }

        function openDiffViewerForCommit(commitHash) {
            // Find the previous commit to compare with
            const commits = commitLogState.allCommits;
            const commitIndex = commits.findIndex(c => c.hash === commitHash);

            if (commitIndex === -1) {
                updateStatus('❌ Cannot find commit for diff.', 'error');
                return;
            }

            // Open diff viewer
            openDiffViewer();

            // Set the commits in the diff viewer
            setTimeout(() => {
                const toSelect = document.getElementById('diffToCommit');
                const fromSelect = document.getElementById('diffFromCommit');

                if (toSelect) toSelect.value = commitHash;

                // Set previous commit as "from" if available
                if (commitIndex < commits.length - 1 && fromSelect) {
                    fromSelect.value = commits[commitIndex + 1].hash;
                }

                // Auto-generate diff if both commits are selected
                if (fromSelect && fromSelect.value && toSelect.value) {
                    generateDiff();
                }
            }, 100);
        }

        async function refreshBranches() {
            if (!currentRepo) return;

            try {
                const branches = await currentRepo.listBranches();
                const current = await currentRepo.getCurrentBranch();

                elements.currentBranch.textContent = `Current: ${current}`;

                // Update branch select
                elements.branchSelect.innerHTML = '<option value="">Select branch</option>' +
                    branches.map(branch => `<option value="${branch.name}" ${branch.name === current ? 'selected' : ''}>${branch.name}</option>`).join('');

                // Update export branch select (only show branches with commits)
                elements.exportBranchSelect.innerHTML = '<option value="">Select branch to export</option>' +
                    branches.filter(branch => branch.hash).map(branch => `<option value="${branch.name}">${branch.name}</option>`).join('');

                // Update delete branch select (exclude current branch)
                elements.deleteBranchSelect.innerHTML = '<option value="">Select branch to delete</option>' +
                    branches.filter(branch => branch.name !== current).map(branch => `<option value="${branch.name}">${branch.name}</option>`).join('');

                // Update branch list
                elements.branchItems.innerHTML = branches.map(branch => `
                    <div class="branch-item ${branch.name === current ? 'current' : ''}">
                        <div class="branch-name">${branch.name === current ? '* ' : '  '}${branch.name}</div>
                        <div class="branch-hash">${branch.hash ? branch.hash.substring(0, 8) : 'no commits'}</div>
                    </div>
                `).join('');

                // Update merge branch selectors
                await populateMergeBranches();

            } catch (error) {
                console.error('Failed to refresh branches:', error);
            }
        }

        // File Explorer Functions
        function switchExplorerTab(tab) {
            // Update tab states
            document.querySelectorAll('.explorer-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.explorer-view').forEach(v => v.classList.remove('active'));

            document.getElementById(`${tab}Tab`).classList.add('active');
            document.getElementById(`${tab}View`).classList.add('active');

            // Refresh appropriate content
            if (tab === 'staged') refreshStagedFiles();
            else if (tab === 'committed') refreshCommittedFiles();
        }

        async function refreshStagedFiles() {
            if (!currentRepo) return;

            try {
                // Use getStagedFiles to get ONLY staged files, not committed files
                const filesResult = await currentRepo.getStagedFiles();
                const files = Array.isArray(filesResult) ? filesResult : ((filesResult && filesResult.files) || []);
                const count = files.length;

                // Update tab label
                elements.stagedTab.textContent = `📦 Staging Area (${count})`;

                // Ensure consistent file object format for buildFileTree
                const normalizedFiles = files.map(file => {
                    if (typeof file === 'string') {
                        return { path: file, name: file, _isStringFile: true };
                    }
                    return file;
                });

                // Build the modern file tree
                buildFileTree(normalizedFiles, elements.stagedTree, 'staged');

            } catch (error) {
                console.error('Failed to refresh staged files:', error);
            }
        }

        async function refreshCommittedFiles() {
            if (!currentRepo) return;

            try {
                const commits = await currentRepo.getCommits(10);
                if (commits.length === 0) {
                    elements.commitSelect.innerHTML = '<option value="">No commits available</option>';
                    elements.committedTree.innerHTML = '<div class="text-center text-muted">No commits yet - create your first commit to see files here</div>';
                    return;
                }

                // Populate commit selector
                elements.commitSelect.innerHTML = '<option value="">Select commit to browse</option>' +
                    commits.map(commit => `<option value="${commit.hash}">${commit.hash} - ${commit.message}</option>`).join('');

                // Auto-select and load the latest commit
                const latestCommit = commits[0];
                elements.commitSelect.value = latestCommit.hash;
                await loadCommittedFiles();

            } catch (error) {
                console.error('Failed to refresh committed files:', error);
                elements.committedTree.innerHTML = '<div class="empty-state">Error loading commits</div>';
            }
        }

        async function refreshStatus() {
            if (!currentRepo) return;

            try {
                // Get current branch
                const currentBranch = await currentRepo.getCurrentBranch() || 'main';
                document.getElementById('currentBranchStatus').textContent = currentBranch;

                // Get staged files with defensive check
                const stagedFilesResult = currentRepo.getStagedFiles ? await currentRepo.getStagedFiles() : [];
                const stagedFiles = Array.isArray(stagedFilesResult) ? stagedFilesResult : ((stagedFilesResult && stagedFilesResult.files) || []);
                const stagedCount = stagedFiles.length;

                // Get repository state
                let repoState = 'Clean working directory';
                if (stagedCount > 0) {
                    repoState = `${stagedCount} file${stagedCount === 1 ? '' : 's'} staged for commit`;
                }

                document.getElementById('repoStateStatus').textContent = repoState;


                // Update repository summary
                await updateRepositorySummary();

            } catch (error) {
                console.error('Failed to refresh status:', error);
                document.getElementById('repoStateStatus').textContent = 'Error loading status';
            }
        }



        async function updateRepositorySummary() {
            try {
                const stats = await currentRepo.getStats();
                const commits = await currentRepo.getCommits(1);

                // Update total commits (browser getStats returns 'commits', not 'commitCount')
                document.getElementById('totalCommitsCount').textContent = stats.commits || 0;

                // Update last commit info
                const lastCommitElement = document.getElementById('lastCommitInfo');
                if (commits.length > 0) {
                    const lastCommit = commits[0];
                    const commitDate = new Date(lastCommit.timestamp * 1000).toLocaleDateString();
                    lastCommitElement.textContent = `${lastCommit.hash.substring(0, 8)} (${commitDate})`;
                } else {
                    lastCommitElement.textContent = 'None';
                }

                // Update repository size (browser getStats returns 'dbSize', not 'totalSize')
                document.getElementById('repoSizeInfo').textContent = formatFileSize(stats.dbSize || 0);

            } catch (error) {
                console.error('Failed to update repository summary:', error);
                document.getElementById('totalCommitsCount').textContent = 'Error';
                document.getElementById('lastCommitInfo').textContent = 'Error';
                document.getElementById('repoSizeInfo').textContent = 'Error';
            }
        }

        async function loadCommittedFiles() {
            const commitHash = elements.commitSelect.value;
            if (!commitHash || !currentRepo) {
                elements.committedTree.innerHTML = '<div class="empty-state">Select a commit to view files</div>';
                return;
            }

            try {
                // Use the worker method
                const files = await currentRepo.getCommitFiles(commitHash);

                // Ensure consistent file object format for buildFileTree
                const normalizedFiles = files.map(file => {
                    if (typeof file === 'string') {
                        return { path: file, name: file, _isStringFile: true };
                    }
                    return file;
                });

                // Build the modern file tree
                buildFileTree(normalizedFiles, elements.committedTree, 'committed');

            } catch (error) {
                console.error('Failed to load committed files:', error);
                elements.committedTree.innerHTML = '<div class="empty-state">Error loading files from this commit</div>';
            }
        }

        // Download file from specific commit
        async function downloadCommittedFile(commitHash, fileName) {
            if (!currentRepo) return;

            try {
                const fileContent = await currentRepo.getFileFromCommit(fileName, commitHash);
                if (!fileContent) {
                    alert(`File ${fileName} not found in commit`);
                    return;
                }

                // Create download with proper MIME type
                const mimeType = getMimeType(fileName);
                const blob = new Blob([fileContent], { type: mimeType });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = fileName;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);

                updateStatus(`✅ Downloaded ${fileName} from commit ${commitHash.substring(0, 8)}`, 'success');
            } catch (error) {
                console.error('Download failed:', error);
                updateStatus(`❌ Failed to download ${fileName}: ${error.message}`, 'error');
            }
        }

        // Get MIME type from file extension
        function getMimeType(fileName) {
            const ext = fileName.toLowerCase().split('.').pop();
            const mimeTypes = {
                // Images
                'jpg': 'image/jpeg',
                'jpeg': 'image/jpeg',
                'png': 'image/png',
                'gif': 'image/gif',
                'webp': 'image/webp',
                'svg': 'image/svg+xml',
                'bmp': 'image/bmp',
                'ico': 'image/x-icon',

                // Documents
                'pdf': 'application/pdf',
                'doc': 'application/msword',
                'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                'xls': 'application/vnd.ms-excel',
                'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'ppt': 'application/vnd.ms-powerpoint',
                'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',

                // Text/Code
                'txt': 'text/plain',
                'md': 'text/markdown',
                'html': 'text/html',
                'htm': 'text/html',
                'css': 'text/css',
                'js': 'text/javascript',
                'json': 'application/json',
                'xml': 'text/xml',
                'csv': 'text/csv',
                'py': 'text/x-python',
                'java': 'text/x-java-source',
                'c': 'text/x-c',
                'cpp': 'text/x-c++',
                'h': 'text/x-c',
                'hpp': 'text/x-c++',
                'rs': 'text/x-rust',
                'go': 'text/x-go',
                'php': 'text/x-php',
                'rb': 'text/x-ruby',
                'sh': 'text/x-shellscript',
                'yaml': 'text/yaml',
                'yml': 'text/yaml',
                'toml': 'text/plain',
                'ini': 'text/plain',
                'conf': 'text/plain',
                'log': 'text/plain',

                // Audio
                'mp3': 'audio/mpeg',
                'wav': 'audio/wav',
                'ogg': 'audio/ogg',
                'm4a': 'audio/mp4',
                'flac': 'audio/flac',

                // Video
                'mp4': 'video/mp4',
                'avi': 'video/x-msvideo',
                'mov': 'video/quicktime',
                'wmv': 'video/x-ms-wmv',
                'webm': 'video/webm',
                'mkv': 'video/x-matroska',

                // Archives
                'zip': 'application/zip',
                'tar': 'application/x-tar',
                'gz': 'application/gzip',
                '7z': 'application/x-7z-compressed',
                'rar': 'application/vnd.rar'
            };

            return mimeTypes[ext] || 'application/octet-stream';
        }

        // View file content from specific commit - let browser handle the file type
        async function viewCommittedFile(commitHash, fileName) {
            if (!currentRepo) return;

            try {
                const fileContent = await currentRepo.getFileFromCommit(fileName, commitHash);
                if (!fileContent) {
                    alert(`File ${fileName} not found in commit`);
                    return;
                }

                // Get the appropriate MIME type for this file
                const mimeType = getMimeType(fileName);

                // Create a blob with the correct MIME type
                const blob = new Blob([fileContent], { type: mimeType });

                // Create object URL and open in new tab - let browser decide how to handle it
                const url = URL.createObjectURL(blob);
                const newWindow = window.open(url, '_blank');

                // Set a meaningful title
                if (newWindow) {
                    newWindow.addEventListener('load', () => {
                        newWindow.document.title = `${fileName} - ${commitHash.substring(0, 8)}`;
                    });
                }

                // Clean up the object URL after a delay to prevent memory leaks
                setTimeout(() => {
                    URL.revokeObjectURL(url);
                }, 60000); // Clean up after 1 minute

            } catch (error) {
                console.error('View failed:', error);
                alert(`Failed to view ${fileName}: ${error.message}`);
            }
        }

        async function clearStagedFiles() {
            if (!currentRepo || !confirm('Clear all staged files?')) return;

            try {
                showProgress('Clearing staging area...');
                await currentRepo.clearStagingArea();
                await refreshStagedFiles();
                updateStatus('✅ Cleared all staged files', 'success');
                hideProgress();

            } catch (error) {
                console.error('Failed to clear staged files:', error);
                updateStatus(`❌ Failed to clear staged files: ${error.message}`, 'error');
                hideProgress();
            }
        }

        // Global functions for file operations
        window.removeFile = async function(filename) {
            if (!currentRepo || !confirm(`Remove ${filename} from staging?`)) return;

            try {
                await currentRepo.removeFile(filename);
                updateStatus(`✅ Removed ${filename} from staging`, 'success');
                await refreshAll();
            } catch (error) {
                console.error('Failed to remove file:', error);
                updateStatus(`❌ Failed to remove ${filename}: ${error.message}`, 'error');
            }
        };

        // Global unstage function for onclick handlers
        window.unstageFile = async function(filename) {
            await unstageFileWithConfirmation(filename);
        };

        // File upload handling - now uses batch processing in worker
        async function handleFileUpload(event) {
            const files = Array.from(event.target.files);
            if (files.length === 0) return;

            try {
                showProgress(`Processing ${files.length} file(s)...`);

                // Read all files into memory first
                const fileData = await Promise.all(files.map(async (file) => {
                    const arrayBuffer = await file.arrayBuffer();
                    return {
                        path: file.name,
                        content: new Uint8Array(arrayBuffer),
                        isBinary: null // Let the worker determine this
                    };
                }));

                // Send batch to worker for processing
                const result = await currentRepo.addFilesBatch(fileData);

                // Update UI with results
                if (result.addedCount > 0 && result.unchangedCount > 0) {
                    updateStatus(`✅ Added ${result.addedCount} file(s), ${result.unchangedCount} file(s) unchanged from HEAD`, 'success');
                } else if (result.addedCount > 0) {
                    updateStatus(`✅ Added ${result.addedCount} file(s) to staging area`, 'success');
                } else if (result.unchangedCount > 0) {
                    updateStatus(`ℹ️ ${result.unchangedCount} file(s) are identical to HEAD - nothing staged`, 'info');
                }

                await refreshStagedFiles();
                hideProgress();
            } catch (error) {
                console.error('Failed to process files:', error);
                updateStatus(`❌ Failed to process files: ${error.message}`, 'error');
                hideProgress();
            }

            // Clear the input
            event.target.value = '';
        }

        // Directory upload handling - now uses batch processing in worker
        async function handleDirectoryUpload(event) {
            const files = Array.from(event.target.files);
            if (files.length === 0) return;

            try {
                showProgress(`📁 Processing directory with ${files.length} files...`);

                // Read all files into memory first
                const fileData = await Promise.all(files.map(async (file) => {
                    const arrayBuffer = await file.arrayBuffer();
                    return {
                        path: file.webkitRelativePath || file.name,
                        content: new Uint8Array(arrayBuffer),
                        isBinary: null // Let the worker determine this
                    };
                }));

                // Send batch to worker for processing
                const result = await currentRepo.addFilesBatch(fileData);

                // Update UI with results
                if (result.addedCount > 0 && result.unchangedCount > 0) {
                    updateStatus(`✅ Directory processed: ${result.addedCount} file(s) added, ${result.unchangedCount} unchanged from HEAD`, 'success');
                } else if (result.addedCount > 0) {
                    updateStatus(`✅ Added ${result.addedCount} file(s) from directory to staging area`, 'success');
                } else if (result.unchangedCount > 0) {
                    updateStatus(`ℹ️ Directory processed: ${result.unchangedCount} file(s) are identical to HEAD - nothing staged`, 'info');
                }

                await refreshStagedFiles();
                hideProgress();
            } catch (error) {
                console.error('Failed to process directory:', error);
                updateStatus(`❌ Failed to process directory: ${error.message}`, 'error');
                hideProgress();
            }

            // Clear the input
            event.target.value = '';
        }

        // Modern File Explorer Functions
        function getFileIcon(fileName, isDirectory = false) {
            if (isDirectory) return '📁';

            const ext = fileName.split('.').pop().toLowerCase();
            const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'ico'];
            const codeExts = ['js', 'html', 'css', 'json', 'md', 'xml', 'yml', 'yaml'];
            const archiveExts = ['zip', 'tar', 'gz', 'rar', '7z'];

            if (imageExts.includes(ext)) return '🖼️';
            if (codeExts.includes(ext)) return '📄';
            if (archiveExts.includes(ext)) return '📦';
            if (ext === 'pdf') return '📕';
            if (ext === 'txt') return '📝';

            return '📄';
        }

        function buildFileTree(files, container, type = 'staged') {
            if (!files || files.length === 0) {
                container.innerHTML = `<div class="empty-state">
                    ${type === 'staged' ? 'No staged files - upload files above to get started' : 'No files in this commit'}
                </div>`;
                return;
            }

            // Build directory structure
            const tree = {};
            files.forEach(file => {
                const filePath = file.path || file.name || file;
                const parts = filePath.split('/');
                let current = tree;

                parts.forEach((part, index) => {
                    if (!current[part]) {
                        current[part] = index === parts.length - 1 ? { _file: file } : {};
                    }
                    current = current[part];
                });
            });

            container.innerHTML = '';
            renderTreeNode(tree, container, '', type);
        }

        function renderTreeNode(node, container, path = '', type = 'staged') {
            Object.keys(node).forEach(key => {
                if (key === '_file') return;

                const item = document.createElement('div');
                const fullPath = path ? `${path}/${key}` : key;
                const isFile = node[key]._file;
                const hasChildren = !isFile && Object.keys(node[key]).length > 0;

                if (isFile) {
                    // File item
                    const filePath = node[key]._file.path || node[key]._file.name || key;
                    const displayName = node[key]._file.name || node[key]._file.path || key;
                    item.className = 'tree-item';
                    item.innerHTML = `
                        <div class="tree-toggle"></div>
                        <div class="tree-icon">${getFileIcon(key)}</div>
                        <div class="tree-name" title="${fullPath}">${displayName}</div>
                        <div class="file-actions-modern">
                            <button class="action-btn" onclick="viewFile('${filePath}', '${type}')" title="View">👁️</button>
                            <button class="action-btn" onclick="downloadFile('${filePath}', '${type}')" title="Download">💾</button>
                            ${type === 'staged' ? `<button class="action-btn unstage" onclick="unstageFile('${filePath}')" title="Unstage file">📤</button>` : ''}
                            ${type === 'staged' ? `<button class="action-btn delete" onclick="deleteFile('${filePath}')" title="Permanently delete file">🗑️</button>` : ''}
                        </div>
                    `;
                } else {
                    // Directory item
                    item.className = 'tree-item directory';
                    item.innerHTML = `
                        <div class="tree-toggle" onclick="toggleDirectory(this)">${hasChildren ? '▶' : ''}</div>
                        <div class="tree-icon">📁</div>
                        <div class="tree-name" title="${fullPath}">${key}</div>
                        <div class="tree-meta">${Object.keys(node[key]).length} items</div>
                    `;

                    container.appendChild(item);

                    if (hasChildren) {
                        const children = document.createElement('div');
                        children.className = 'tree-children collapsed';
                        renderTreeNode(node[key], children, fullPath, type);
                        container.appendChild(children);
                    }
                    return;
                }

                container.appendChild(item);
            });
        }

        function toggleDirectory(toggle) {
            const item = toggle.closest('.tree-item');
            const children = item.nextElementSibling;

            if (children && children.classList.contains('tree-children')) {
                children.classList.toggle('collapsed');
                toggle.textContent = children.classList.contains('collapsed') ? '▶' : '▼';
            }
        }

        function setupFileSearch() {
            elements.stagedSearch.addEventListener('input', (e) => {
                filterTree(elements.stagedTree, e.target.value);
            });

            elements.committedSearch.addEventListener('input', (e) => {
                filterTree(elements.committedTree, e.target.value);
            });
        }

        function filterTree(container, searchTerm) {
            const items = container.querySelectorAll('.tree-item');
            const term = searchTerm.toLowerCase();

            items.forEach(item => {
                const name = item.querySelector('.tree-name').textContent.toLowerCase();
                const matches = name.includes(term);
                item.style.display = matches || !term ? 'flex' : 'none';

                // Show parent directories if child matches
                if (matches && term) {
                    let parent = item.parentElement;
                    while (parent && parent.classList.contains('tree-children')) {
                        parent.classList.remove('collapsed');
                        const toggle = parent.previousElementSibling && parent.previousElementSibling.querySelector('.tree-toggle');
                        if (toggle) toggle.textContent = '▼';
                        parent = parent.parentElement && parent.parentElement.parentElement;
                    }
                }
            });
        }

        async function unstageFile(fileName) {
            if (!currentRepo) {
                updateStatus('❌ No repository loaded.', 'error');
                return;
            }

            if (!fileName) {
                updateStatus('❌ No file specified for unstaging.', 'error');
                return;
            }

            try {
                showProgress(`Unstaging ${fileName}...`);

                // Remove file from staging area
                await currentRepo.removeFile(fileName);

                // Update all relevant UI components
                await Promise.all([
                    refreshStagedFiles(),
                    refreshStatus() // Update the repository status panel
                ]);

                updateStatus(`✅ Unstaged ${fileName}`, 'success');
                hideProgress();

            } catch (error) {
                console.error('Failed to unstage file:', error);
                updateStatus(`❌ Failed to unstage ${fileName}: ${error.message}`, 'error');
                hideProgress();
            }
        }

        // Enhanced unstage with confirmation for bulk operations
        async function unstageFileWithConfirmation(fileName, skipConfirmation = false) {
            if (!skipConfirmation && !confirm(`Remove ${fileName} from staging area?`)) {
                return;
            }

            await unstageFile(fileName);
        }

        // === File Deletion Functions ===
        async function deleteFile(fileName, fromWhere = 'staged') {
            if (!currentRepo) {
                updateStatus('❌ No repository loaded.', 'error');
                return;
            }

            if (!fileName) {
                updateStatus('❌ No file specified for deletion.', 'error');
                return;
            }

            // Show confirmation dialog with clear warning
            const confirmMessage = `⚠️ PERMANENTLY DELETE "${fileName}"?\n\nThis action cannot be undone. The file will be:\n• Removed from the repository\n• Deleted from your staging area\n• Lost forever\n\nAre you sure you want to continue?`;

            if (!confirm(confirmMessage)) {
                return;
            }

            try {
                showProgress(`Deleting ${fileName}...`);

                // Remove file from repository
                await currentRepo.removeFile(fileName);

                // Update all relevant UI components
                await Promise.all([
                    refreshStagedFiles(),
                    refreshCommittedFiles(),
                    refreshStatus()
                ]);

                updateStatus(`🗑️ Permanently deleted ${fileName}`, 'success');
                hideProgress();

            } catch (error) {
                console.error('Failed to delete file:', error);
                updateStatus(`❌ Failed to delete ${fileName}: ${error.message}`, 'error');
                hideProgress();
            }
        }

        async function deleteMultipleFiles(fileNames) {
            if (!currentRepo) {
                updateStatus('❌ No repository loaded.', 'error');
                return;
            }

            if (!fileNames || fileNames.length === 0) {
                updateStatus('❌ No files specified for deletion.', 'error');
                return;
            }

            const fileList = fileNames.join('\n• ');
            const confirmMessage = `⚠️ PERMANENTLY DELETE ${fileNames.length} FILES?\n\nThese files will be permanently deleted:\n• ${fileList}\n\nThis action cannot be undone. Are you sure?`;

            if (!confirm(confirmMessage)) {
                return;
            }

            try {
                showProgress(`Deleting ${fileNames.length} files...`);

                // Delete each file
                for (const fileName of fileNames) {
                    await currentRepo.removeFile(fileName);
                }

                // Update all relevant UI components
                await Promise.all([
                    refreshStagedFiles(),
                    refreshCommittedFiles(),
                    refreshStatus()
                ]);

                updateStatus(`🗑️ Permanently deleted ${fileNames.length} file${fileNames.length === 1 ? '' : 's'}`, 'success');
                hideProgress();

            } catch (error) {
                console.error('Failed to delete files:', error);
                updateStatus(`❌ Failed to delete files: ${error.message}`, 'error');
                hideProgress();
            }
        }

        // Delete all staged files
        async function deleteAllStagedFiles() {
            if (!currentRepo) {
                updateStatus('❌ No repository loaded.', 'error');
                return;
            }

            try {
                const stagedFilesResult = await currentRepo.getStagedFiles();
                const stagedFiles = Array.isArray(stagedFilesResult) ? stagedFilesResult : ((stagedFilesResult && stagedFilesResult.files) || []);

                if (stagedFiles.length === 0) {
                    updateStatus('ℹ️ No staged files to delete.', 'info');
                    return;
                }

                await deleteMultipleFiles(stagedFiles);

            } catch (error) {
                console.error('Failed to delete all staged files:', error);
                updateStatus(`❌ Failed to delete staged files: ${error.message}`, 'error');
            }
        }

        // Global delete function for onclick handlers
        window.deleteFile = async function(filename) {
            await deleteFile(filename, 'staged');
        };

        // Unstage all staged files
        async function unstageAllFiles() {
            if (!currentRepo) {
                updateStatus('❌ No repository loaded.', 'error');
                return;
            }

            try {
                const stagedFilesResult = await currentRepo.getStagedFiles();
                const stagedFiles = Array.isArray(stagedFilesResult) ? stagedFilesResult : ((stagedFilesResult && stagedFilesResult.files) || []);

                if (stagedFiles.length === 0) {
                    updateStatus('ℹ️ No files to unstage.', 'info');
                    return;
                }

                const confirmMessage = `Remove all ${stagedFiles.length} file${stagedFiles.length === 1 ? '' : 's'} from staging area?`;
                if (!confirm(confirmMessage)) {
                    return;
                }

                showProgress(`Unstaging ${stagedFiles.length} files...`);

                // Unstage all files
                for (const fileName of stagedFiles) {
                    await currentRepo.removeFile(fileName);
                }

                // Update all relevant UI components
                await Promise.all([
                    refreshStagedFiles(),
                    refreshStatus()
                ]);

                updateStatus(`✅ Unstaged ${stagedFiles.length} file${stagedFiles.length === 1 ? '' : 's'}`, 'success');
                hideProgress();

            } catch (error) {
                console.error('Failed to unstage all files:', error);
                updateStatus(`❌ Failed to unstage files: ${error.message}`, 'error');
                hideProgress();
            }
        }

        async function viewFile(fileName, type) {
            if (type === 'staged') {
                // View staged file
                try {
                    const fileContent = await currentRepo.getFileContent(fileName);
                    if (!fileContent) {
                        updateStatus(`❌ File not found: ${fileName}`, 'error');
                        return;
                    }
                    showFileContent(fileName, fileContent);
                } catch (error) {
                    updateStatus(`❌ Error viewing file: ${error.message}`, 'error');
                }
            } else if (type === 'committed') {
                // View committed file
                const commitHash = elements.commitSelect.value;
                if (commitHash) {
                    viewCommittedFile(commitHash, fileName);
                }
            }
        }

        async function downloadFile(fileName, type) {
            if (type === 'staged') {
                // Download staged file
                try {
                    const fileContent = await currentRepo.getFileContent(fileName);
                    if (!fileContent) {
                        updateStatus(`❌ File not found: ${fileName}`, 'error');
                        return;
                    }
                    downloadFileContent(fileName, fileContent);
                } catch (error) {
                    updateStatus(`❌ Error downloading file: ${error.message}`, 'error');
                }
            } else if (type === 'committed') {
                // Download committed file
                const commitHash = elements.commitSelect.value;
                if (commitHash) {
                    downloadCommittedFile(commitHash, fileName);
                }
            }
        }

        function showFileContent(fileName, content, hash = null) {
            try {
                // Calculate hash if not provided
                if (!hash && content) {
                    // Simple hash for display - not cryptographic
                    hash = Array.from(new Uint8Array(content.slice(0, 16)))
                        .map(b => b.toString(16).padStart(2, '0'))
                        .join('') + '...';
                }

                // Check if content is binary
                const isBinary = checkIfBinary(content);
                const fileSize = formatFileSize(content.byteLength || content.length);
                const fileType = getFileType(fileName);

                // Update modal content
                document.getElementById('fileViewerTitle').textContent = `📄 ${fileName}`;
                document.getElementById('fileViewerSize').textContent = fileSize;
                document.getElementById('fileViewerType').textContent = fileType;
                document.getElementById('fileViewerHash').textContent = hash || 'N/A';

                const contentElement = document.getElementById('fileViewerContent');

                if (isBinary) {
                    contentElement.className = 'file-content binary';

                    // Get MIME type for proper media rendering
                    const mimeType = getMimeType(fileName);

                    // Create blob URL for binary content
                    const uint8Array = content instanceof Uint8Array ? content : new Uint8Array(content);
                    const blob = new Blob([uint8Array], { type: mimeType });
                    const blobUrl = URL.createObjectURL(blob);

                    // Handle different file types appropriately
                    if (mimeType.startsWith('image/')) {
                        // Display images
                        contentElement.innerHTML = `
                            <div class="media-container">
                                <img src="${blobUrl}" alt="${fileName}" style="max-width: 100%; max-height: 500px; border-radius: 4px;">
                                <p class="media-info">📷 Image file (${fileSize})</p>
                            </div>
                        `;
                    } else if (mimeType.startsWith('video/')) {
                        // Display videos
                        contentElement.innerHTML = `
                            <div class="media-container">
                                <video controls style="max-width: 100%; max-height: 500px; border-radius: 4px;">
                                    <source src="${blobUrl}" type="${mimeType}">
                                    Your browser does not support the video tag.
                                </video>
                                <p class="media-info">🎬 Video file (${fileSize})</p>
                            </div>
                        `;
                    } else if (mimeType.startsWith('audio/')) {
                        // Display audio players
                        contentElement.innerHTML = `
                            <div class="media-container">
                                <audio controls style="width: 100%;">
                                    <source src="${blobUrl}" type="${mimeType}">
                                    Your browser does not support the audio tag.
                                </audio>
                                <p class="media-info">🎵 Audio file (${fileSize})</p>
                            </div>
                        `;
                    } else if (mimeType === 'application/pdf') {
                        // Display PDFs
                        contentElement.innerHTML = `
                            <div class="media-container">
                                <iframe src="${blobUrl}" style="width: 100%; height: 500px; border: 1px solid #ddd; border-radius: 4px;"></iframe>
                                <p class="media-info">📕 PDF document (${fileSize})</p>
                            </div>
                        `;
                    } else {
                        // Generic binary file message for unsupported types
                        contentElement.textContent = `📦 Binary file (${fileSize})\n\nThis file contains binary data and cannot be displayed as text.\nUse the download button to save it to your computer.`;
                    }

                    // Clean up blob URL when modal is closed to prevent memory leaks
                    const cleanup = () => {
                        URL.revokeObjectURL(blobUrl);
                        document.removeEventListener('modalClosed', cleanup);
                    };
                    document.addEventListener('modalClosed', cleanup);

                } else {
                    contentElement.className = 'file-content';
                    // Convert Uint8Array to string for text files
                    const textContent = typeof content === 'string' ? content :
                        new TextDecoder('utf-8', { fatal: false }).decode(content);
                    contentElement.textContent = textContent;
                }

                // Show the modal
                openModal('fileViewerModal');

            } catch (error) {
                console.error('Failed to show file content:', error);
                updateStatus(`❌ Failed to view ${fileName}: ${error.message}`, 'error');
            }
        }

        function downloadFileContent(fileName, content) {
            // Use proper MIME type instead of generic fallbacks
            const mimeType = getMimeType(fileName);
            const blob = new Blob([content], { type: mimeType });

            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }

        // === Modal Management ===
        function openModal(modalId) {
            const modal = document.getElementById(modalId);
            if (modal) {
                modal.classList.add('active');
                document.body.style.overflow = 'hidden'; // Prevent background scrolling
            }
        }

        function closeModal(modalId) {
            const modal = document.getElementById(modalId);
            if (modal) {
                modal.classList.remove('active');
                document.body.style.overflow = ''; // Restore scrolling

                // Dispatch modal closed event for cleanup
                document.dispatchEvent(new CustomEvent('modalClosed', { detail: { modalId } }));
            }
        }

        // === Utility Functions ===
        function checkIfBinary(content) {
            if (!content) return false;

            // Convert to Uint8Array if needed
            const bytes = content instanceof Uint8Array ? content : new Uint8Array(content);

            // Check first 1024 bytes for null bytes or high percentage of non-printable chars
            const sampleSize = Math.min(1024, bytes.length);
            let nonPrintable = 0;

            for (let i = 0; i < sampleSize; i++) {
                const byte = bytes[i];
                // Null byte definitely indicates binary
                if (byte === 0) return true;
                // Count non-printable characters (except common whitespace)
                if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) {
                    nonPrintable++;
                }
            }

            // If more than 30% non-printable, consider it binary
            return (nonPrintable / sampleSize) > 0.3;
        }

        function formatFileSize(bytes) {
            if (!bytes || bytes === 0) return '0 B';
            const sizes = ['B', 'KB', 'MB', 'GB'];
            const i = Math.floor(Math.log(bytes) / Math.log(1024));
            return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
        }

        function getFileType(fileName) {
            const ext = fileName.split('.').pop().toLowerCase();
            const types = {
                'js': 'JavaScript',
                'ts': 'TypeScript',
                'html': 'HTML',
                'css': 'CSS',
                'json': 'JSON',
                'md': 'Markdown',
                'txt': 'Text',
                'py': 'Python',
                'java': 'Java',
                'cpp': 'C++',
                'c': 'C',
                'h': 'Header',
                'xml': 'XML',
                'yml': 'YAML',
                'yaml': 'YAML',
                'sql': 'SQL',
                'png': 'PNG Image',
                'jpg': 'JPEG Image',
                'jpeg': 'JPEG Image',
                'gif': 'GIF Image',
                'svg': 'SVG Image',
                'pdf': 'PDF Document',
                'zip': 'ZIP Archive',
                'tar': 'TAR Archive',
                'gz': 'GZIP Archive'
            };
            return types[ext] || ext.toUpperCase() + ' File';
        }

        // === Time Travel / Commit Checkout Functions ===
        let currentCheckoutState = {
            isDetached: false,
            commitHash: null,
            commitMessage: '',
            originalBranch: 'main'
        };

        async function checkoutCommit(commitHash) {
            if (!currentRepo || !commitHash) {
                updateStatus('❌ Invalid commit or repository not loaded.', 'error');
                return;
            }

            try {
                showProgress('Checking out commit...');

                // Get commit details
                const commits = await currentRepo.getCommits(1000);
                const commit = commits.find(c => c.hash === commitHash);

                if (!commit) {
                    updateStatus('❌ Commit not found.', 'error');
                    hideProgress();
                    return;
                }

                // Warning about detached HEAD state
                const confirmMessage = `⚠️ CHECKOUT COMMIT (TIME TRAVEL)\n\nYou are about to checkout commit:\n${commitHash.substring(0, 8)} - ${commit.message}\n\nThis will put you in "detached HEAD" state where:\n• You can view files as they were at this point\n• Changes won't be saved to your current branch\n• You can explore history safely\n\nDo you want to continue?`;

                if (!confirm(confirmMessage)) {
                    hideProgress();
                    return;
                }

                // Store original branch if not already in detached state
                if (!currentCheckoutState.isDetached) {
                    currentCheckoutState.originalBranch = await currentRepo.getCurrentBranch() || 'main';
                }

                // Perform checkout using repository reset functionality
                await currentRepo.reset(commitHash, { mode: 'hard' });

                // Update checkout state
                currentCheckoutState.isDetached = true;
                currentCheckoutState.commitHash = commitHash;
                currentCheckoutState.commitMessage = commit.message;

                // Update UI to reflect detached state
                updateTimeravelUI();

                // Refresh all UI components
                await Promise.all([
                    refreshStagedFiles(),
                    refreshCommittedFiles(),
                    refreshStatus()
                ]);

                updateStatus(`🕰️ Checked out commit ${commitHash.substring(0, 8)} - Time travel mode active`, 'success');
                hideProgress();

            } catch (error) {
                console.error('Failed to checkout commit:', error);
                updateStatus(`❌ Failed to checkout commit: ${error.message}`, 'error');
                hideProgress();
            }
        }

        async function returnToHead() {
            if (!currentRepo) {
                updateStatus('❌ No repository loaded.', 'error');
                return;
            }

            if (!currentCheckoutState.isDetached) {
                updateStatus('ℹ️ Already at latest commit.', 'info');
                return;
            }

            try {
                showProgress('Returning to latest commit...');

                // Get the latest commit from the original branch
                const commits = await currentRepo.getCommits(1);
                if (commits.length === 0) {
                    updateStatus('❌ No commits found.', 'error');
                    hideProgress();
                    return;
                }

                const latestCommit = commits[0];

                // Reset to the latest commit
                await currentRepo.reset(latestCommit.hash, { mode: 'hard' });

                // Clear detached state
                currentCheckoutState.isDetached = false;
                currentCheckoutState.commitHash = null;
                currentCheckoutState.commitMessage = '';

                // Update UI to reflect normal state
                updateTimeravelUI();

                // Refresh all UI components
                await Promise.all([
                    refreshStagedFiles(),
                    refreshCommittedFiles(),
                    refreshStatus()
                ]);

                updateStatus(`✅ Returned to latest commit on ${currentCheckoutState.originalBranch}`, 'success');
                hideProgress();

            } catch (error) {
                console.error('Failed to return to HEAD:', error);
                updateStatus(`❌ Failed to return to latest: ${error.message}`, 'error');
                hideProgress();
            }
        }

        function updateTimeravelUI() {
            const checkoutStatusItem = document.getElementById('checkoutStatusItem');
            const checkoutStatus = document.getElementById('checkoutStatus');
            const timeTravelControls = document.getElementById('timeTravelControls');
            const repoStateStatus = document.getElementById('repoStateStatus');

            if (currentCheckoutState.isDetached) {
                // Show detached HEAD state
                if (checkoutStatusItem) {
                    checkoutStatusItem.style.display = 'flex';
                }
                if (checkoutStatus) {
                    checkoutStatus.textContent = `${currentCheckoutState.commitHash.substring(0, 8)} (detached)`;
                }
                if (timeTravelControls) {
                    timeTravelControls.style.display = 'block';
                }
                if (repoStateStatus) {
                    repoStateStatus.textContent = `Time travel mode - ${currentCheckoutState.commitMessage.substring(0, 50)}`;
                }
            } else {
                // Show normal state
                if (checkoutStatusItem) {
                    checkoutStatusItem.style.display = 'none';
                }
                if (timeTravelControls) {
                    timeTravelControls.style.display = 'none';
                }
                if (repoStateStatus) {
                    repoStateStatus.textContent = 'Clean working directory';
                }
            }
        }

        // === Merge Operations Functions ===
        let mergeState = {
            sourceBranch: null,
            targetBranch: null,
            previewData: null,
            conflictsDetected: false,
            inProgress: false
        };

        async function populateMergeBranches() {
            if (!currentRepo) return;

            try {
                const branches = await currentRepo.listBranches();
                const currentBranch = await currentRepo.getCurrentBranch() || 'main';

                // Update merge source branch selector
                const sourceSelect = document.getElementById('mergeSourceBranch');
                const targetInput = document.getElementById('mergeTargetBranch');

                if (sourceSelect) {
                    sourceSelect.innerHTML = '<option value="">Select branch to merge...</option>';
                    branches.forEach(branch => {
                        const branchName = typeof branch === 'string' ? branch : branch.name;
                        if (branchName !== currentBranch) {
                            const option = new Option(branchName, branchName);
                            sourceSelect.appendChild(option);
                        }
                    });
                }

                if (targetInput) {
                    targetInput.value = currentBranch;
                }

            } catch (error) {
                console.error('Failed to populate merge branches:', error);
            }
        }

        async function previewMerge() {
            const sourceBranch = document.getElementById('mergeSourceBranch').value;
            const targetBranch = document.getElementById('mergeTargetBranch').value;

            if (!sourceBranch) {
                updateStatus('❌ Please select a branch to merge.', 'error');
                return;
            }

            if (!currentRepo) {
                updateStatus('❌ No repository loaded.', 'error');
                return;
            }

            try {
                showProgress('Analyzing merge...');

                // Store merge parameters
                mergeState.sourceBranch = sourceBranch;
                mergeState.targetBranch = targetBranch;

                // Perform merge preview using repository merge functionality
                const mergeResult = await currentRepo.merge(sourceBranch, { preview: true });

                // Normalize merge result structure from worker response
                const safeResult = normalizeMergeResult(mergeResult);

                // Store preview data
                mergeState.previewData = safeResult;
                mergeState.conflictsDetected = !safeResult.success || safeResult.type === 'conflict' || (safeResult.conflicts && safeResult.conflicts.length > 0);

                // Display merge preview
                displayMergePreview(safeResult);

                hideProgress();

            } catch (error) {
                console.error('Failed to preview merge:', error);
                updateStatus(`❌ Failed to preview merge: ${error.message}`, 'error');
                hideProgress();
            }
        }

        function displayMergePreview(mergeResult) {
            const mergeStatus = document.getElementById('mergeStatus');
            const mergeSummary = document.getElementById('mergeSummary');
            const mergeConflicts = document.getElementById('mergeConflicts');
            const conflictList = document.getElementById('conflictList');

            // Show merge status section
            if (mergeStatus) {
                mergeStatus.style.display = 'block';
            }

            // Check for conflicts using the proper merge result structure
            const hasConflicts = !mergeResult.success || mergeResult.type === 'conflict' || (mergeResult.conflicts && mergeResult.conflicts.length > 0);

            if (hasConflicts) {
                // Show conflicts
                mergeState.conflictsDetected = true;

                const conflictCount = (mergeResult.conflicts && mergeResult.conflicts.length) || 0;

                if (mergeSummary) {
                    mergeSummary.innerHTML = `
                        <strong>⚠️ Merge cannot be completed automatically</strong><br>
                        Source: <code>${mergeState.sourceBranch}</code><br>
                        Target: <code>${mergeState.targetBranch}</code><br>
                        Conflicts: <strong>${conflictCount}</strong> file(s)
                    `;
                }

                if (mergeConflicts) {
                    mergeConflicts.style.display = 'block';
                }

                if (conflictList && mergeResult.conflicts && mergeResult.conflicts.length > 0) {
                    const conflictsHtml = mergeResult.conflicts.map(conflict => `
                        <div class="conflict-item">
                            <div class="conflict-file">${conflict.file}</div>
                            <div class="conflict-type">Conflict type: ${conflict.type}</div>
                        </div>
                    `).join('');
                    conflictList.innerHTML = conflictsHtml;
                } else if (conflictList) {
                    conflictList.innerHTML = '<div class="conflict-item">No conflict details available</div>';
                }

                updateStatus('⚠️ Merge conflicts detected. Review conflicts before proceeding.', 'warning');

            } else {
                // Clean merge possible
                mergeState.conflictsDetected = false;

                if (mergeSummary) {
                    mergeSummary.innerHTML = `
                        <strong>✅ Clean merge possible</strong><br>
                        Source: <code>${mergeState.sourceBranch}</code><br>
                        Target: <code>${mergeState.targetBranch}</code><br>
                        No conflicts detected - safe to proceed
                    `;
                }

                if (mergeConflicts) {
                    mergeConflicts.style.display = 'none';
                }

                updateStatus('✅ Merge preview complete - no conflicts detected.', 'success');
            }
        }

        async function executeMerge() {
            if (!mergeState.sourceBranch || !currentRepo) {
                updateStatus('❌ Please preview merge first.', 'error');
                return;
            }

            if (mergeState.conflictsDetected) {
                updateStatus('❌ Cannot execute merge with unresolved conflicts.', 'error');
                return;
            }

            const confirmMessage = `🔀 EXECUTE MERGE\n\nMerge "${mergeState.sourceBranch}" into "${mergeState.targetBranch}"?\n\nThis will create a new commit and cannot be undone easily.\n\nProceed with merge?`;

            if (!confirm(confirmMessage)) {
                return;
            }

            try {
                showProgress('Executing merge...');
                mergeState.inProgress = true;

                // Execute the actual merge
                const mergeResult = await currentRepo.merge(mergeState.sourceBranch);

                if (mergeResult.conflicts && mergeResult.conflicts.length > 0) {
                    // Unexpected conflicts during execution
                    displayMergePreview(mergeResult);
                    updateStatus('⚠️ Conflicts detected during merge execution.', 'error');
                } else {
                    // Successful merge
                    await handleMergeSuccess(mergeResult);
                }

                mergeState.inProgress = false;
                hideProgress();

            } catch (error) {
                console.error('Failed to execute merge:', error);
                updateStatus(`❌ Merge failed: ${error.message}`, 'error');
                mergeState.inProgress = false;
                hideProgress();
            }
        }

        async function handleMergeSuccess(mergeResult) {
            // Update merge status to show success
            const mergeStatus = document.getElementById('mergeStatus');
            const mergeInfo = document.getElementById('mergeInfo');

            if (mergeInfo) {
                mergeInfo.innerHTML = `
                    <h4>✅ Merge Completed Successfully</h4>
                    <div class="merge-summary merge-success">
                        <strong>Merge completed</strong><br>
                        Merged: <code>${mergeState.sourceBranch}</code> → <code>${mergeState.targetBranch}</code><br>
                        ${mergeResult.commitHash ? `New commit: <code>${mergeResult.commitHash.substring(0, 8)}</code>` : ''}
                    </div>
                `;
            }

            // Hide conflicts section
            const mergeConflicts = document.getElementById('mergeConflicts');
            if (mergeConflicts) {
                mergeConflicts.style.display = 'none';
            }

            // Reset merge state
            resetMergeState();

            // Refresh all UI components
            await Promise.all([
                refreshCommits(),
                refreshBranches(),
                refreshStagedFiles(),
                refreshStatus()
            ]);

            updateStatus('🎉 Merge completed successfully!', 'success');

            // Auto-hide merge status after success
            setTimeout(() => {
                if (mergeStatus) {
                    mergeStatus.style.display = 'none';
                }
            }, 5000);
        }

        function resetMergeState() {
            mergeState = {
                sourceBranch: null,
                targetBranch: null,
                previewData: null,
                conflictsDetected: false,
                inProgress: false
            };

            // Reset UI
            const sourceSelect = document.getElementById('mergeSourceBranch');
            if (sourceSelect) {
                sourceSelect.value = '';
            }
        }

        async function abortMerge() {
            if (!mergeState.inProgress) {
                // Just reset the UI
                const mergeStatus = document.getElementById('mergeStatus');
                if (mergeStatus) {
                    mergeStatus.style.display = 'none';
                }
                resetMergeState();
                updateStatus('ℹ️ Merge preview cleared.', 'info');
                return;
            }

            // If merge is actually in progress, would need to implement merge abort
            updateStatus('⚠️ Merge abort not implemented yet.', 'warning');
        }

        function resolveConflicts() {
            // For now, show a message about manual conflict resolution
            updateStatus('🛠️ Conflict resolution interface coming soon. Please resolve conflicts manually.', 'info');
        }

        // === Repository Analytics Functions ===
        async function refreshAnalytics() {
            if (!currentRepo) return;

            try {
                showProgress('Analyzing repository...');

                // Get basic repository analytics
                const analytics = await getRepositoryAnalytics();

                // Display the analytics
                displayAnalytics(analytics);

                // Show analytics section
                const analyticsSection = document.getElementById('analyticsSection');
                if (analyticsSection) {
                    analyticsSection.style.display = 'block';
                }

                hideProgress();

            } catch (error) {
                console.error('Failed to refresh analytics:', error);
                updateStatus(`❌ Failed to load analytics: ${error.message}`, 'error');
                hideProgress();
            }
        }

        async function getRepositoryAnalytics() {
            const analytics = {
                totalObjects: 0,
                totalSize: 0,
                compressionRatio: 0,
                objectBreakdown: { commits: 0, trees: 0, blobs: 0 },
                fileTypes: {},
                efficiency: {
                    deduplicationSavings: 0,
                    averageFileSize: 0,
                    largestObject: 0
                }
            };

            try {
                // Get repository statistics if available
                if (currentRepo.getStorageAnalytics) {
                    const repoAnalytics = await currentRepo.getStorageAnalytics();

                    analytics.totalObjects = repoAnalytics.totalObjects || 0;
                    analytics.totalSize = repoAnalytics.totalSize || 0;
                    analytics.compressionRatio = repoAnalytics.compressionRatio || 0;
                    analytics.deduplicationSavings = repoAnalytics.deduplicationSavings || 0;

                    // Map object breakdown to expected UI format
                    if (repoAnalytics.objectBreakdown) {
                        analytics.objectBreakdown.commits = repoAnalytics.objectBreakdown.commits || 0;
                        analytics.objectBreakdown.trees = repoAnalytics.objectBreakdown.trees || 0;
                        analytics.objectBreakdown.blobs = repoAnalytics.objectBreakdown.blobs || 0;
                    }

                    // Use backend-calculated efficiency metrics
                    analytics.efficiency.averageFileSize = repoAnalytics.averageFileSize || 0;
                    analytics.efficiency.largestObject = repoAnalytics.largestObject || 0;
                } else {
                    // Fallback: calculate analytics manually
                    await calculateAnalyticsManually(analytics);
                }

                // Analyze file types from staged and committed files
                await analyzeFileTypes(analytics);

            } catch (error) {
                console.error('Error calculating analytics:', error);
                // Return default analytics on error
            }

            return analytics;
        }

        async function calculateAnalyticsManually(analytics) {
            try {
                // Get commits for object counting
                const commits = await currentRepo.getCommits(1000);
                analytics.objectBreakdown.commits = commits.length;

                // Get staged files
                const stagedFilesResult = await currentRepo.getStagedFiles();
                const stagedFiles = Array.isArray(stagedFilesResult) ? stagedFilesResult : ((stagedFilesResult && stagedFilesResult.files) || []);
                analytics.objectBreakdown.blobs += stagedFiles.length;

                // Estimate total objects
                analytics.totalObjects = analytics.objectBreakdown.commits +
                                        analytics.objectBreakdown.blobs +
                                        analytics.objectBreakdown.trees;

                // Note: efficiency metrics now calculated by backend

            } catch (error) {
                console.error('Failed to calculate manual analytics:', error);
            }
        }

        async function analyzeFileTypes(analytics) {
            try {
                // Get all files from the latest commit instead of just staged files
                const commits = await currentRepo.getCommits(1);
                if (commits.length === 0) {
                    return; // No commits yet
                }

                const latestCommitFiles = await currentRepo.getCommitFiles(commits[0].hash);

                for (const file of latestCommitFiles) {
                    const fileName = file.name || file.path || file;
                    const extension = getFileExtension(fileName);
                    const fileType = getFileTypeCategory(extension);

                    if (!analytics.fileTypes[fileType]) {
                        analytics.fileTypes[fileType] = { count: 0, size: 0, extensions: new Set() };
                    }

                    analytics.fileTypes[fileType].count++;
                    analytics.fileTypes[fileType].extensions.add(extension);

                    // Use the file size from the commit data
                    const size = file.size || 0;
                    analytics.fileTypes[fileType].size += size;
                }

            } catch (error) {
                console.error('Failed to analyze file types:', error);
            }
        }

        function getFileExtension(fileName) {
            const parts = fileName.split('.');
            return parts.length > 1 ? parts.pop().toLowerCase() : 'no-extension';
        }

        function getFileTypeCategory(extension) {
            const categories = {
                'js': 'JavaScript',
                'ts': 'TypeScript',
                'jsx': 'React',
                'tsx': 'React',
                'html': 'HTML',
                'css': 'Stylesheets',
                'scss': 'Stylesheets',
                'sass': 'Stylesheets',
                'json': 'JSON',
                'md': 'Documentation',
                'txt': 'Text',
                'py': 'Python',
                'java': 'Java',
                'cpp': 'C++',
                'c': 'C',
                'h': 'Headers',
                'xml': 'XML',
                'yml': 'YAML',
                'yaml': 'YAML',
                'sql': 'SQL',
                'png': 'Images',
                'jpg': 'Images',
                'jpeg': 'Images',
                'gif': 'Images',
                'svg': 'Images',
                'pdf': 'Documents',
                'doc': 'Documents',
                'docx': 'Documents',
                'zip': 'Archives',
                'tar': 'Archives',
                'gz': 'Archives',
                'no-extension': 'Other'
            };

            return categories[extension] || 'Other';
        }

        function displayAnalytics(analytics) {
            // Update overview cards
            document.getElementById('totalStorageSize').textContent = formatFileSize(analytics.totalSize);
            document.getElementById('totalObjects').textContent = analytics.totalObjects.toLocaleString();
            document.getElementById('compressionRatio').textContent = analytics.compressionRatio ?
                `${analytics.compressionRatio.toFixed(1)}%` : 'N/A';

            // Calculate and display efficiency
            const efficiency = analytics.totalObjects > 0 ?
                Math.min(100, (((analytics.objectBreakdown && analytics.objectBreakdown.blobs) || 0) / analytics.totalObjects) * 100) : 0;
            document.getElementById('efficiency').textContent = `${efficiency.toFixed(1)}%`;

            // Update object breakdown with safe fallbacks
            document.getElementById('commitObjects').textContent = ((analytics.objectBreakdown && analytics.objectBreakdown.commits) || 0).toLocaleString();
            document.getElementById('treeObjects').textContent = ((analytics.objectBreakdown && analytics.objectBreakdown.trees) || 0).toLocaleString();
            document.getElementById('blobObjects').textContent = ((analytics.objectBreakdown && analytics.objectBreakdown.blobs) || 0).toLocaleString();

            // Update efficiency metrics with safe fallbacks
            const deduplicationSavings = analytics.deduplicationSavings || 0;
            document.getElementById('deduplicationSavings').textContent = `${deduplicationSavings.toFixed(1)}%`;
            document.getElementById('averageFileSize').textContent = formatFileSize((analytics.efficiency && analytics.efficiency.averageFileSize) || 0);
            document.getElementById('largestObject').textContent = formatFileSize((analytics.efficiency && analytics.efficiency.largestObject) || 0);

            // Display file type analysis
            displayFileTypeAnalysis(analytics.fileTypes);
        }

        function displayFileTypeAnalysis(fileTypes) {
            const container = document.getElementById('fileTypeAnalysis');

            if (!fileTypes || Object.keys(fileTypes).length === 0) {
                container.innerHTML = '<div class="empty-state">No files to analyze</div>';
                return;
            }

            // Sort file types by count
            const sortedTypes = Object.entries(fileTypes)
                .sort(([,a], [,b]) => b.count - a.count);

            const totalFiles = sortedTypes.reduce((sum, [, data]) => sum + data.count, 0);

            const html = sortedTypes.map(([type, data]) => {
                const percentage = totalFiles > 0 ? (data.count / totalFiles) * 100 : 0;

                return `
                    <div class="file-type-item">
                        <div class="file-type-name">
                            <span>${getFileTypeIcon(type)}</span>
                            <span>${type}</span>
                        </div>
                        <div class="file-type-stats">
                            <span class="file-type-count">${data.count}</span>
                            <span class="file-type-size">${formatFileSize(data.size)}</span>
                        </div>
                        <div class="file-type-bar">
                            <div class="file-type-bar-fill" style="width: ${percentage}%"></div>
                        </div>
                    </div>
                `;
            }).join('');

            container.innerHTML = html;
        }

        function getFileTypeIcon(type) {
            const icons = {
                'JavaScript': '📜',
                'TypeScript': '📘',
                'React': '⚛️',
                'HTML': '🌐',
                'Stylesheets': '🎨',
                'JSON': '📋',
                'Documentation': '📖',
                'Text': '📄',
                'Python': '🐍',
                'Java': '☕',
                'C++': '⚙️',
                'C': '🔧',
                'Headers': '📑',
                'XML': '📰',
                'YAML': '⚙️',
                'SQL': '🗃️',
                'Images': '🖼️',
                'Documents': '📋',
                'Archives': '📦',
                'Other': '📁'
            };

            return icons[type] || '📄';
        }

        // === Diff Viewer Functions ===
        function openDiffViewer() {
            if (!currentRepo) {
                updateStatus('❌ No repository loaded.', 'error');
                return;
            }

            // Populate commit dropdowns
            populateDiffCommitSelectors();

            // Reset the diff content
            document.getElementById('diffSummary').style.display = 'none';
            document.getElementById('diffContent').innerHTML = '<div class="empty-state">Select two commits to generate a diff</div>';

            // Open the modal
            openModal('diffViewerModal');
        }

        async function populateDiffCommitSelectors() {
            const fromSelect = document.getElementById('diffFromCommit');
            const toSelect = document.getElementById('diffToCommit');

            if (!fromSelect || !toSelect) return;

            try {
                const commits = await currentRepo.getCommits(50); // Get last 50 commits

                // Clear existing options (keep the default option)
                fromSelect.innerHTML = '<option value="">Select commit...</option>';
                toSelect.innerHTML = '<option value="">Select commit...</option>';

                commits.forEach(commit => {
                    const shortHash = commit.hash.substring(0, 8);
                    const optionText = `${shortHash} - ${commit.message.substring(0, 50)}${commit.message.length > 50 ? '...' : ''}`;

                    const fromOption = new Option(optionText, commit.hash);
                    const toOption = new Option(optionText, commit.hash);

                    fromSelect.appendChild(fromOption);
                    toSelect.appendChild(toOption);
                });

                // Pre-select latest commit as "to" if available
                if (commits.length > 0) {
                    toSelect.value = commits[0].hash;
                }
                // Pre-select second latest as "from" if available
                if (commits.length > 1) {
                    fromSelect.value = commits[1].hash;
                }

            } catch (error) {
                console.error('Failed to populate commit selectors:', error);
            }
        }

        function swapCommits() {
            const fromSelect = document.getElementById('diffFromCommit');
            const toSelect = document.getElementById('diffToCommit');

            const fromValue = fromSelect.value;
            fromSelect.value = toSelect.value;
            toSelect.value = fromValue;
        }

        async function generateDiff() {
            const fromCommit = document.getElementById('diffFromCommit').value;
            const toCommit = document.getElementById('diffToCommit').value;

            if (!fromCommit || !toCommit) {
                updateStatus('❌ Please select both commits to compare.', 'error');
                return;
            }

            if (fromCommit === toCommit) {
                updateStatus('❌ Cannot compare a commit with itself.', 'error');
                return;
            }

            try {
                showProgress('Generating diff...');

                // Get diff from repository
                const diff = await currentRepo.diffCommits(fromCommit, toCommit);

                // Display the diff
                displayDiff(diff, fromCommit, toCommit);

                hideProgress();

            } catch (error) {
                console.error('Failed to generate diff:', error);
                updateStatus(`❌ Failed to generate diff: ${error.message}`, 'error');
                hideProgress();
            }
        }

        function displayDiff(diff, fromCommit, toCommit) {
            const diffSummary = document.getElementById('diffSummary');
            const diffContent = document.getElementById('diffContent');

            // Calculate statistics
            let totalFiles = diff.length;
            let totalAdditions = 0;
            let totalDeletions = 0;

            diff.forEach(fileDiff => {
                if (fileDiff.additions) totalAdditions += fileDiff.additions;
                if (fileDiff.deletions) totalDeletions += fileDiff.deletions;
            });

            // Update summary
            document.getElementById('diffFileCount').textContent = totalFiles;
            document.getElementById('diffAdditions').textContent = totalAdditions;
            document.getElementById('diffDeletions').textContent = totalDeletions;
            diffSummary.style.display = 'block';

            // Generate diff content HTML
            if (totalFiles === 0) {
                diffContent.innerHTML = '<div class="empty-state">No differences found between the selected commits</div>';
                return;
            }

            const diffHtml = diff.map(fileDiff => {
                const fileName = fileDiff.file.name || fileDiff.file.path || fileDiff.file;
                const diffType = fileDiff.type;

                let diffContentHtml = '';

                if (fileDiff.binary) {
                    diffContentHtml = '<div class="diff-binary">Binary files differ</div>';
                } else if (fileDiff.diff) {
                    diffContentHtml = formatUnifiedDiff(fileDiff.diff);
                } else {
                    diffContentHtml = `<div class="diff-binary">File ${diffType}</div>`;
                }

                return `
                    <div class="diff-file">
                        <div class="diff-file-header">
                            <span class="diff-type-indicator">${getDiffTypeIcon(diffType)}</span>
                            ${fileName}
                            ${fileDiff.additions || fileDiff.deletions ?
                                `<span class="diff-file-stats">
                                    ${fileDiff.additions ? `<span class="additions">+${fileDiff.additions}</span>` : ''}
                                    ${fileDiff.deletions ? `<span class="deletions">-${fileDiff.deletions}</span>` : ''}
                                </span>` : ''
                            }
                        </div>
                        <div class="diff-file-content">
                            ${diffContentHtml}
                        </div>
                    </div>
                `;
            }).join('');

            diffContent.innerHTML = diffHtml;
        }

        function formatUnifiedDiff(diffText) {
            const lines = diffText.split('\n');
            let html = '';
            let leftLineNum = 1;
            let rightLineNum = 1;

            lines.forEach(line => {
                if (line.startsWith('@@')) {
                    // Parse hunk header to get line numbers
                    const match = line.match(/@@ -(\d+),?\d* \+(\d+),?\d* @@/);
                    if (match) {
                        leftLineNum = parseInt(match[1]);
                        rightLineNum = parseInt(match[2]);
                    }
                    html += `<div class="diff-line hunk-header"><div class="diff-line-content">${line}</div></div>`;
                } else if (line.startsWith('+') && !line.startsWith('+++')) {
                    html += `
                        <div class="diff-line addition">
                            <div class="diff-line-numbers">
                                <span class="diff-line-number"></span>
                                <span class="diff-line-number">${rightLineNum}</span>
                            </div>
                            <div class="diff-line-content">${escapeHtml(line)}</div>
                        </div>
                    `;
                    rightLineNum++;
                } else if (line.startsWith('-') && !line.startsWith('---')) {
                    html += `
                        <div class="diff-line deletion">
                            <div class="diff-line-numbers">
                                <span class="diff-line-number">${leftLineNum}</span>
                                <span class="diff-line-number"></span>
                            </div>
                            <div class="diff-line-content">${escapeHtml(line)}</div>
                        </div>
                    `;
                    leftLineNum++;
                } else if (!line.startsWith('---') && !line.startsWith('+++')) {
                    html += `
                        <div class="diff-line context">
                            <div class="diff-line-numbers">
                                <span class="diff-line-number">${leftLineNum}</span>
                                <span class="diff-line-number">${rightLineNum}</span>
                            </div>
                            <div class="diff-line-content">${escapeHtml(line)}</div>
                        </div>
                    `;
                    leftLineNum++;
                    rightLineNum++;
                }
            });

            return html;
        }

        function getDiffTypeIcon(type) {
            const icons = {
                'added': '✅',
                'deleted': '❌',
                'modified': '✏️',
                'renamed': '🔄'
            };
            return icons[type] || '📄';
        }

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        // Initialize the application
        document.addEventListener('DOMContentLoaded', () => {
            initApp();
            setupFileSearch();

            // Setup modal event listeners
            const fileViewerModal = document.getElementById('fileViewerModal');
            const fileViewerClose = document.getElementById('fileViewerClose');
            const fileViewerClose2 = document.getElementById('fileViewerClose2');

            // Close modal on X button or Close button
            if (fileViewerClose) {
                fileViewerClose.addEventListener('click', () => closeModal('fileViewerModal'));
            }
            if (fileViewerClose2) {
                fileViewerClose2.addEventListener('click', () => closeModal('fileViewerModal'));
            }

            // Close modal on background click
            if (fileViewerModal) {
                fileViewerModal.addEventListener('click', (e) => {
                    if (e.target === fileViewerModal) {
                        closeModal('fileViewerModal');
                    }
                });
            }

            // Diff viewer modal event listeners
            const diffViewerModal = document.getElementById('diffViewerModal');
            const diffViewerClose = document.getElementById('diffViewerClose');
            const diffViewerClose2 = document.getElementById('diffViewerClose2');
            const generateDiffButton = document.getElementById('generateDiffButton');
            const swapCommitsButton = document.getElementById('swapCommitsButton');

            // Close diff modal buttons
            if (diffViewerClose) {
                diffViewerClose.addEventListener('click', () => closeModal('diffViewerModal'));
            }
            if (diffViewerClose2) {
                diffViewerClose2.addEventListener('click', () => closeModal('diffViewerModal'));
            }

            // Diff modal controls
            if (generateDiffButton) {
                generateDiffButton.addEventListener('click', generateDiff);
            }
            if (swapCommitsButton) {
                swapCommitsButton.addEventListener('click', swapCommits);
            }

            // Close diff modal on background click
            if (diffViewerModal) {
                diffViewerModal.addEventListener('click', (e) => {
                    if (e.target === diffViewerModal) {
                        closeModal('diffViewerModal');
                    }
                });
            }

            // Commit details modal event listeners
            const commitDetailsModal = document.getElementById('commitDetailsModal');
            const commitDetailsClose = document.getElementById('commitDetailsClose');
            const commitDetailsClose2 = document.getElementById('commitDetailsClose2');

            // Close commit details modal buttons
            if (commitDetailsClose) {
                commitDetailsClose.addEventListener('click', () => closeModal('commitDetailsModal'));
            }
            if (commitDetailsClose2) {
                commitDetailsClose2.addEventListener('click', () => closeModal('commitDetailsModal'));
            }

            // Close commit details modal on background click
            if (commitDetailsModal) {
                commitDetailsModal.addEventListener('click', (e) => {
                    if (e.target === commitDetailsModal) {
                        closeModal('commitDetailsModal');
                    }
                });
            }

            // Close modal on Escape key
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    closeModal('fileViewerModal');
                    closeModal('diffViewerModal');
                    closeModal('commitDetailsModal');
                }
            });
        });