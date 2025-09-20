/**
 * WebDVCS Browser Interface Tests
 * Focused, professional tests that validate specific functionality
 */

const { test, expect } = require('@playwright/test');

test.describe('WebDVCS Browser Interface', () => {
  let page;

  test.beforeEach(async ({ browser }) => {
    page = await browser.newPage();

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        console.log(`Browser error: ${msg.text()}`);
      }
    });

    await page.goto('http://localhost:8080/');
    await page.waitForSelector('#createRepoButton', { timeout: 15000 });
    await page.waitForFunction(() => {
      const status = document.querySelector('#repoStatus');
      return status && status.textContent.includes('Ready');
    }, { timeout: 20000 });
  });

  test.afterEach(async () => {
    if (page) await page.close();
  });

  test('repository creation and author setup', async () => {
    // Set author information
    await page.fill('#authorName', 'Test User');
    await page.fill('#authorEmail', 'test@example.com');
    await page.click('#saveAuthorButton');

    // Create repository
    await page.fill('#repoName', 'test-repo');
    await page.click('#createRepoButton');

    // Wait for creation confirmation
    await page.waitForFunction(() => {
      const status = document.querySelector('#repoStatus');
      return status && (
        status.textContent.includes('created successfully') ||
        status.textContent.includes('Ready')
      );
    }, { timeout: 15000 });

    // Verify repository info is displayed
    await expect(page.locator('#repoInfo')).toBeVisible();

    // Verify initial stats
    const commitCount = await page.textContent('#commitCount');
    const fileCount = await page.textContent('#fileCount');
    const branchCount = await page.textContent('#branchCount');

    expect(commitCount).toBe('0');
    expect(fileCount).toBe('0');
    expect(branchCount).toBe('1');
  });

  test('file upload and staging', async () => {
    // Setup repository
    await page.fill('#repoName', 'file-test-repo');
    await page.click('#createRepoButton');
    await page.waitForFunction(() => {
      const status = document.querySelector('#repoStatus');
      return status && status.textContent.includes('Ready');
    }, { timeout: 15000 });

    // Upload specific test files
    const testFiles = [
      { name: 'README.md', content: '# Test Repository' },
      { name: 'index.js', content: 'console.log("test");' }
    ];

    for (const file of testFiles) {
      await page.locator('#uploadFile').setInputFiles({
        name: file.name,
        mimeType: 'text/plain',
        buffer: Buffer.from(file.content)
      });

      // Wait for file processing
      await page.waitForFunction((fileName) => {
        const items = document.querySelectorAll('#stagedTree .tree-item');
        return Array.from(items).some(item => item.textContent.includes(fileName));
      }, file.name, { timeout: 5000 });
    }

    // Verify exact number of staged files
    await page.click('#stagedTab');
    const stagedFiles = await page.locator('#stagedTree .tree-item').count();
    expect(stagedFiles).toBe(testFiles.length);

    // Verify file count stat updated
    const fileCount = await page.textContent('#fileCount');
    expect(fileCount).toBe('0'); // Not committed yet
  });

  test('commit creation and history', async () => {
    // Setup repository with files
    await page.fill('#repoName', 'commit-test-repo');
    await page.click('#createRepoButton');
    await page.waitForFunction(() => {
      const status = document.querySelector('#repoStatus');
      return status && status.textContent.includes('Ready');
    }, { timeout: 15000 });

    // Add file
    await page.locator('#uploadFile').setInputFiles({
      name: 'test.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('test content')
    });

    // Wait for staging
    await page.waitForFunction(() => {
      const items = document.querySelectorAll('#stagedTree .tree-item');
      return items.length > 0;
    }, { timeout: 5000 });

    // Create commit
    await page.fill('#commitMessage', 'Test commit');
    await page.click('#commitButton');

    // Wait for commit completion
    await page.waitForFunction(() => {
      const commitCount = document.querySelector('#commitCount');
      return commitCount && commitCount.textContent === '1';
    }, { timeout: 10000 });

    // Verify stats updated correctly
    const commitCount = await page.textContent('#commitCount');
    const fileCount = await page.textContent('#fileCount');

    expect(commitCount).toBe('1');
    expect(fileCount).toBe('1');

    // Verify commit appears in history
    const commits = await page.locator('#commitHistory .commit-item, #commitHistory .tree-item').count();
    expect(commits).toBeGreaterThanOrEqual(1);
  });

  test('branch creation and switching', async () => {
    // Setup repository
    await page.fill('#repoName', 'branch-test-repo');
    await page.click('#createRepoButton');
    await page.waitForFunction(() => {
      const status = document.querySelector('#repoStatus');
      return status && status.textContent.includes('Ready');
    }, { timeout: 15000 });

    // First create a commit to make sure we have content
    await page.locator('#uploadFile').setInputFiles({
      name: 'test.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('test content for branch switching')
    });

    await page.waitForFunction(() => {
      const items = document.querySelectorAll('#stagedTree .tree-item');
      return items.length > 0;
    }, { timeout: 5000 });

    await page.fill('#commitMessage', 'Initial commit for branch test');
    await page.click('#commitButton');

    await page.waitForFunction(() => {
      const commitCount = document.querySelector('#commitCount');
      return commitCount && commitCount.textContent === '1';
    }, { timeout: 10000 });

    // Create branch
    const branchName = 'feature-test';
    await page.fill('#branchName', branchName);
    await page.click('#createBranchButton');

    // Wait for branch creation
    await page.waitForFunction((name) => {
      const select = document.querySelector('#branchSelect');
      if (!select) return false;
      const options = Array.from(select.options);
      return options.some(option => option.value === name);
    }, branchName, { timeout: 5000 });

    // Wait for branch count to update to 2
    await page.waitForFunction(() => {
      const branchCount = document.querySelector('#branchCount');
      return branchCount && branchCount.textContent === '2';
    }, { timeout: 10000 });

    // Verify branch count updated
    const branchCount = await page.textContent('#branchCount');
    expect(branchCount).toBe('2');

    // Switch to new branch
    await page.selectOption('#branchSelect', branchName);
    await page.click('#switchBranchButton');

    // Wait for branch switch to complete
    await page.waitForFunction((name) => {
      const currentBranch = document.querySelector('#currentBranch');
      return currentBranch && currentBranch.textContent.includes(name);
    }, branchName, { timeout: 10000 });

    // Verify current branch display updated
    const currentBranchText = await page.textContent('#currentBranch');
    expect(currentBranchText).toContain(branchName);
  });

  test('repository export functionality', async () => {
    // Setup repository with content
    await page.fill('#repoName', 'export-test-repo');
    await page.click('#createRepoButton');
    await page.waitForFunction(() => {
      const status = document.querySelector('#repoStatus');
      return status && status.textContent.includes('Ready');
    }, { timeout: 15000 });

    // Add file and commit
    await page.locator('#uploadFile').setInputFiles({
      name: 'export-test.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('export test content')
    });

    await page.waitForFunction(() => {
      const items = document.querySelectorAll('#stagedTree .tree-item');
      return items.length > 0;
    }, { timeout: 5000 });

    await page.fill('#commitMessage', 'Export test commit');
    await page.click('#commitButton');

    await page.waitForFunction(() => {
      const commitCount = document.querySelector('#commitCount');
      return commitCount && commitCount.textContent === '1';
    }, { timeout: 10000 });

    // Test export
    const downloadPromise = page.waitForEvent('download');
    await page.click('#downloadRepoButton');
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/\.sqlite$/);
  });

  test('error handling validation', async () => {
    // Track expected errors during this test
    const expectedErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error' &&
          msg.text().includes('Nothing to commit')) {
        expectedErrors.push(msg.text());
      }
    });

    // Setup repository for commit/branch error tests
    await page.fill('#repoName', 'error-test-repo');
    await page.click('#createRepoButton');
    await page.waitForFunction(() => {
      const status = document.querySelector('#repoStatus');
      return status && status.textContent.includes('Ready');
    }, { timeout: 15000 });

    // Test empty commit (no staged files) - this should fail with "Nothing to commit"
    await page.fill('#commitMessage', 'Empty commit test');
    await page.click('#commitButton');

    // Wait and verify no commit was created
    await page.waitForTimeout(3000);
    const commitCount = await page.textContent('#commitCount');
    expect(commitCount).toBe('0');

    // Verify we got the expected error
    expect(expectedErrors.length).toBeGreaterThan(0);

    // Test successful operation for comparison
    await page.locator('#uploadFile').setInputFiles({
      name: 'test.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('test content')
    });

    await page.waitForFunction(() => {
      const items = document.querySelectorAll('#stagedTree .tree-item');
      return items.length > 0;
    }, { timeout: 5000 });

    await page.fill('#commitMessage', 'Valid commit');
    await page.click('#commitButton');

    await page.waitForFunction(() => {
      const commitCount = document.querySelector('#commitCount');
      return commitCount && commitCount.textContent === '1';
    }, { timeout: 10000 });

    // Verify successful commit
    const finalCommitCount = await page.textContent('#commitCount');
    expect(finalCommitCount).toBe('1');

    // Test branch operations work normally
    await page.fill('#branchName', 'test-branch');
    await page.click('#createBranchButton');

    await page.waitForFunction(() => {
      const branchCount = document.querySelector('#branchCount');
      return branchCount && branchCount.textContent === '2';
    }, { timeout: 5000 });

    const branchCount = await page.textContent('#branchCount');
    expect(branchCount).toBe('2');
  });
});