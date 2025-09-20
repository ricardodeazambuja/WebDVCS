/**
 * Branch Manager - Handles branch operations
 * Manages branch creation, switching, listing, and deletion
 */

class BranchManager {
  constructor(store, stagingArea, removedFiles, saveStagingArea, saveRemovedFiles, checkoutFunction, setCurrentCommit) {
    this.store = store;
    this.stagingArea = stagingArea;
    this.removedFiles = removedFiles;
    this.saveStagingArea = saveStagingArea;
    this.saveRemovedFiles = saveRemovedFiles;
    this.checkout = checkoutFunction;
    this.setCurrentCommit = setCurrentCommit;
  }

  /**
   * Create new branch
   */
  createBranch(name, fromCommitHash = null) {
    const created = this.store.createBranch(name, fromCommitHash);
    if (!created) {
      throw new Error(`Branch '${name}' already exists`);
    }
    return name;
  }

  /**
   * Switch to different branch
   */
  switchBranch(name) {
    return this.store.transaction(() => {
      const commitHash = this.store.switchBranch(name);

      if (commitHash) {
        const result = this.checkout(commitHash, null, false);
        return { branch: name, commitHash, ...result };
      } else {
        // Empty branch - clear everything including current commit
        this.stagingArea.clear();
        this.removedFiles.clear();
        this.setCurrentCommit(null);
        this.saveStagingArea();
        this.saveRemovedFiles();
        this.store.setMeta('current_commit', null);
        return { branch: name, commitHash: null, files: {} };
      }
    });
  }

  /**
   * Get current branch name
   */
  getCurrentBranch() {
    return this.store.getCurrentBranch();
  }

  /**
   * List all branches
   */
  listBranches() {
    return this.store.listBranches();
  }

  /**
   * Delete branch
   */
  deleteBranch(name) {
    return this.store.deleteBranch(name);
  }

  /**
   * Check if branch exists
   */
  branchExists(name) {
    const branches = this.listBranches();
    return branches.includes(name);
  }

  /**
   * Get branch count
   */
  getBranchCount() {
    return this.listBranches().length;
  }

  /**
   * Get branch head commit
   */
  getBranchHead(branchName) {
    return this.store.getBranchHead(branchName);
  }
}

module.exports = BranchManager;