/**
 * Branch Transfer Tests - Export and Import functionality
 */

const { MiniRepo } = require('../webdvcs-cli');
const fs = require('fs');
const path = require('path');

function runBranchTransferTests() {
  console.log('Running Branch Transfer Tests...\n');

  // Test 1: Basic branch export
  console.log('Testing basic branch export...');
  const sourceRepo = new MiniRepo(':memory:');

  // Create initial commit
  sourceRepo.addFile('readme.txt', 'Initial readme content');
  const initialCommit = sourceRepo.commit('Initial commit', 'Alice', 'alice@example.com');

  // Create feature branch and add some changes
  sourceRepo.createBranch('feature-export');
  sourceRepo.switchBranch('feature-export');
  sourceRepo.addFile('feature.js', 'console.log("New feature");');
  sourceRepo.addFile('config.json', '{"version": "1.0"}');
  const featureCommit = sourceRepo.commit('Add new feature', 'Alice', 'alice@example.com');

  // Debug: Check branch list before export
  const branches = sourceRepo.listBranches();
  console.log('Available branches:', branches);
  const featureBranch = branches.find(b => b.name === 'feature-export');
  console.log('Feature branch details:', featureBranch);

  // Export the feature branch (returns SQLite binary data)
  const exportData = sourceRepo.exportBranch('feature-export');

  // Validate export is binary SQLite data
  if (!(exportData instanceof Uint8Array)) {
    throw new Error('Export should return SQLite binary data (Uint8Array)');
  }

  if (exportData.length === 0) {
    throw new Error('Export data should not be empty');
  }

  // Check SQLite magic bytes (SQLite files start with "SQLite format 3")
  const magic = new TextDecoder().decode(exportData.slice(0, 16));
  if (!magic.startsWith('SQLite format 3')) {
    throw new Error('Export data should be valid SQLite database');
  }

  console.log(`✅ Branch export: SQLite database (${exportData.length} bytes)`);

  // Test 2: Branch import to new repository
  console.log('Testing branch import to new repository...');
  const targetRepo = new MiniRepo(':memory:');

  // Create completely different base content to avoid conflicts
  targetRepo.addFile('different-base.txt', 'Completely different base content');
  targetRepo.commit('Different base commit', 'Bob', 'bob@example.com');

  // Import the feature branch using file-based import
  const branchExport = sourceRepo.exportBranchToFile('feature-export');
  const importStats = targetRepo.importBranchFromFile(branchExport.data);

  // Validate import statistics - allow for skipped content if already exists
  if (importStats.commits_imported === 0 && importStats.skipped_existing === 0) {
    throw new Error('Import should have either imported commits or skipped existing ones');
  }

  if (importStats.blobs_imported === 0 && importStats.skipped_existing === 0) {
    throw new Error('Import should have either imported blobs or skipped existing ones');
  }

  console.log(`✅ Branch import: ${importStats.commits_imported} commits, ${importStats.trees_imported} trees, ${importStats.blobs_imported} blobs imported`);

  // Test 3: Verify imported branch content
  console.log('Testing imported branch content verification...');

  // Switch to imported branch
  targetRepo.switchBranch('feature-export');

  // Verify files exist
  const files = targetRepo.listFiles();
  const expectedFiles = ['readme.txt', 'feature.js', 'config.json'];

  for (const expectedFile of expectedFiles) {
    if (!files.includes(expectedFile)) {
      throw new Error(`Expected file ${expectedFile} not found in imported branch`);
    }
  }

  // Verify file content
  const readmeContent = targetRepo.cat('readme.txt');
  const featureContent = targetRepo.cat('feature.js');
  const configContent = targetRepo.cat('config.json');

  if (new TextDecoder().decode(readmeContent) !== 'Initial readme content') {
    throw new Error('Readme content mismatch after import');
  }

  if (new TextDecoder().decode(featureContent) !== 'console.log("New feature");') {
    throw new Error('Feature file content mismatch after import');
  }

  if (new TextDecoder().decode(configContent) !== '{"version": "1.0"}') {
    throw new Error('Config file content mismatch after import');
  }

  console.log('✅ Imported branch content verification passed');

  // Test 4: File-based export/import
  console.log('Testing file-based export/import...');

  sourceRepo.switchBranch('feature-export');
  const fileExport = sourceRepo.exportBranchToFile('feature-export');

  if (!fileExport.data || !fileExport.filename) {
    throw new Error('File export should return data and filename');
  }

  if (!fileExport.filename.includes('feature-export')) {
    throw new Error('Export filename should contain branch name');
  }

  // Import from file data
  const newTargetRepo = new MiniRepo(':memory:');
  newTargetRepo.addFile('another-base.txt', 'Another base');
  newTargetRepo.commit('Another base commit', 'Carol', 'carol@example.com');

  const fileImportStats = newTargetRepo.importBranchFromFile(fileExport.data);

  if (fileImportStats.commits_imported === 0) {
    throw new Error('File import should have imported commits');
  }

  console.log('✅ File-based export/import passed');

  // Test 5: Error handling
  console.log('Testing error handling...');

  try {
    sourceRepo.exportBranch('non-existent-branch');
    throw new Error('Should have thrown error for non-existent branch');
  } catch (error) {
    if (!error.message.includes('not found')) {
      throw new Error('Wrong error message for non-existent branch');
    }
  }

  try {
    targetRepo.importBranch(new Uint8Array([1, 2, 3])); // Invalid SQLite data
    throw new Error('Should have thrown error for invalid import data');
  } catch (error) {
    if (!error.message.includes('SQLite')) {
      throw new Error('Wrong error message for invalid import data');
    }
  }

  console.log('✅ Error handling tests passed');

  console.log('\n✅ All branch transfer tests passed!');
}

module.exports = {
  runBranchTransferTests
};