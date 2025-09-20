#!/usr/bin/env node
/**
 * WebDVCS CLI - Command Line Interface for WebDVCS
 * Usage: node webdvcs.js <command> [args...]
 * 
 * Commands:
 *   init          Initialize new repository
 *   add <path>    Stage file or directory
 *   commit <msg>  Create commit with message
 *   log [count]   Show commit history
 *   status        Show repository status
 *   checkout <hash> Checkout specific commit
 *   help          Show this help message
 */

const { MiniRepo, initStore } = require('./webdvcs-cli.js');
const fs = require('fs');
const path = require('path');

// Global repository instance and database path
let repo = null;
let currentDbFile = 'webdvcs.sqlite'; // Default database filename

// Debug flag - zero performance impact when false
let debugMode = false;

// Colors for pretty output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  reset: '\x1b[0m',
  bold: '\x1b[1m'
};

function colorize(text, color) {
  return `${colors[color] || ''}${text}${colors.reset}`;
}

function printHeader(text) {
  console.log(`\n${colorize('='.repeat(50), 'blue')}`);
  console.log(`${colorize(text, 'bold')}`);
  console.log(`${colorize('='.repeat(50), 'blue')}\n`);
}

function printError(text) {
  console.log(`${colorize('❌ Error:', 'red')} ${text}`);
}

function printSuccess(text) {
  console.log(`${colorize('✅', 'green')} ${text}`);
}

function printInfo(text) {
  console.log(`${colorize('ℹ️', 'blue')} ${text}`);
}

function printDebug(text) {
  if (!debugMode) return;
  console.log(`${colorize('🔍', 'cyan')} ${text}`);
}

function formatFileSize(bytes) {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
  } else if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  } else if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)}KB`;
  }
  return `${bytes}B`;
}

function analyzeFiles(files) {
  const stats = {
    total: files.length,
    textFiles: 0,
    binaryFiles: 0,
    totalSize: 0,
    largestFile: { name: '', size: 0 },
    extensions: {}
  };
  
  files.forEach(file => {
    const size = typeof file.size === 'number' ? file.size : (file.length || 0);
    stats.totalSize += size;
    
    if (file.binary) {
      stats.binaryFiles++;
    } else {
      stats.textFiles++;
    }
    
    if (size > stats.largestFile.size) {
      stats.largestFile = { name: file.name || file.path || file, size };
    }
    
    const fileName = file.name || file.path || file;
    const ext = fileName.includes('.') ? fileName.split('.').pop().toLowerCase() : 'no-ext';
    stats.extensions[ext] = (stats.extensions[ext] || 0) + 1;
  });
  
  return stats;
}


function showHelp() {
  printHeader('WebDVCS CLI - Mini Version Control System');
  console.log(`${colorize('Usage:', 'bold')} node webdvcs.js <repo> <command> [args...]`);
  console.log('');
  console.log(`${colorize('Commands:', 'bold')}`);
  console.log(`  ${colorize('init <repo>', 'cyan')}            Initialize or load repository <repo>.sqlite`);
  console.log(`  ${colorize('<repo> add <path>', 'cyan')}      Stage file or directory from disk`);
  console.log(`  ${colorize('<repo> unstage <file>', 'cyan')}   Remove file from staging area`);
  console.log(`  ${colorize('<repo> rm <file>', 'cyan')}        Remove file from next commit (preserves history)`);
  console.log(`  ${colorize('<repo> reset <ref> [--soft|--hard]', 'cyan')} Reset HEAD to commit (default: --soft)`);
  console.log(`  ${colorize('<repo> merge <branch>', 'cyan')}     Merge branch into current branch`);
  console.log(`  ${colorize('<repo> commit <message>', 'cyan')} Create commit with message (quote message)`);
  console.log(`  ${colorize('<repo> log [count]', 'cyan')}     Show commit history (default: 10)`);
  console.log(`  ${colorize('<repo> status', 'cyan')}          Show repository status`);
  console.log(`  ${colorize('<repo> checkout <hash> [file]', 'cyan')} Checkout commit or single file`);
  console.log(`  ${colorize('<repo> ls [path|commit]', 'cyan')}      List files in directory/commit or staged files`);
  console.log(`  ${colorize('<repo> cat <file> [commit]', 'cyan')}   Show file contents from staging/commit`);
  console.log(`  ${colorize('<repo> branch [name]', 'cyan')}   List branches or create new branch`);
  console.log(`  ${colorize('<repo> switch <name>', 'cyan')}   Switch to existing branch`);
  console.log(`  ${colorize('<repo> diff <file1> <file2>', 'cyan')} Compare two files`);
  console.log(`  ${colorize('<repo> diff <commit1> <commit2>', 'cyan')} Compare two commits`);
  console.log(`  ${colorize('<repo> diff --staged', 'cyan')}    Show uncommitted changes`);
  console.log(`  ${colorize('<repo> analytics', 'cyan')}        Show detailed storage analytics and overhead breakdown`);
  console.log(`  ${colorize('<repo> config [key] [value]', 'cyan')} Show or set configuration (author.name, author.email)`);
  console.log(`  ${colorize('<repo> export <branch>', 'cyan')}   Export branch to .webdvcs-branch file`);
  console.log(`  ${colorize('<repo> import <file>', 'cyan')}     Import branch from .webdvcs-branch file`);
  console.log(`  ${colorize('<repo> delete-branch <name>', 'cyan')} Delete branch and run garbage collection`);
  console.log(`  ${colorize('<repo> delete-commit <hash>', 'cyan')} Delete unreferenced commit`);
  console.log(`  ${colorize('<repo> gc', 'cyan')}               Run garbage collection to clean up unreachable objects`);
  console.log(`  ${colorize('help', 'cyan')}                   Show this help message`);
  console.log('');
  console.log(`${colorize('Global Options:', 'bold')}`);
  console.log(`  ${colorize('--debug, -d', 'cyan')}             Show detailed progress during operations`);
  console.log('');
  console.log(`${colorize('Examples:', 'bold')}`);
  console.log(`  node webdvcs.js init myproject              # Create/load myproject.sqlite`);
  console.log(`  node webdvcs.js init docs                   # Create/load docs.sqlite`);
  console.log(`  node webdvcs.js myproject add README.md     # Add file to myproject`);
  console.log(`  node webdvcs.js myproject commit "Fix bug"  # Commit to myproject`);
  console.log(`  node webdvcs.js docs status                 # Check docs repository`);
  console.log(`  node webdvcs.js docs log 5                  # View docs history`);
  console.log(`  node webdvcs.js myproject branch feature    # Create feature branch`);
  console.log(`  node webdvcs.js myproject switch feature    # Switch to feature branch`);
  console.log(`  node webdvcs.js myproject diff file1 file2  # Compare two files`);
  console.log(`  node webdvcs.js myproject diff --staged     # Show uncommitted changes`);
  console.log(`  node webdvcs.js myproject analytics         # Show storage efficiency and overhead`);
  console.log(`  node webdvcs.js myproject export feature    # Export feature branch to file`);
  console.log(`  node webdvcs.js myproject import feature.webdvcs-branch # Import branch from file`);
  console.log(`  node webdvcs.js --debug myproject add src/  # Add directory with progress`);
  console.log(`  node webdvcs.js -d myproject add large_dir/ # Debug mode for large operations`);
  console.log('');
  console.log(`${colorize('Repository Names:', 'bold')}`);
  console.log(`  Repository name becomes <name>.sqlite file`);
  console.log(`  Examples: 'myproject' → myproject.sqlite, 'docs' → docs.sqlite`);
}

function cmdInit(repoName) {
  if (!repoName) {
    printError('Usage: init <repo>');
    printInfo('Example: node webdvcs.js init myproject');
    return;
  }
  
  // Convert repo name to sqlite filename
  const dbFile = repoName.endsWith('.sqlite') ? repoName : `${repoName}.sqlite`;
  const exists = fs.existsSync(dbFile);
  
  if (exists) {
    // Load existing repository
    repo = new MiniRepo(dbFile, debugMode);
    const status = repo.status();
    printSuccess(`Loaded existing repository: ${colorize(repoName, 'yellow')} (${dbFile})`);
    printInfo(`HEAD: ${status.head || '(no commits yet)'}`);
    printInfo(`Chunks: ${status.store_objects}, Size: ${status.db_size} bytes`);
    if (status.staged.length > 0) {
      printInfo(`Staging area has ${status.staged.length} staged files`);
    }
  } else {
    // Create new repository
    repo = new MiniRepo(dbFile, debugMode);
    printSuccess(`Initialized empty WebDVCS repository: ${colorize(repoName, 'yellow')} (${dbFile})`);
    printInfo(`Use "node webdvcs.js ${repoName} add <file|directory>" to stage files or directories`);
  }
  
  currentDbFile = dbFile;
}

function cmdAdd(pathName, forceBinary = false) {
  if (!pathName) {
    printError('Usage: add <file|directory> [--binary]');
    printInfo('Example: node webdvcs.js add README.md');
    printInfo('Example: node webdvcs.js add src/            # Add entire directory');
    return;
  }
  
  if (!fs.existsSync(pathName)) {
    printError(`Path not found: ${pathName}`);
    return;
  }
  
  try {
    const stats = fs.statSync(pathName);
    
    if (stats.isDirectory()) {
      // Handle directory
      const result = repo.addDirectory(pathName, { forceBinary, debug: debugMode });
      if (result.added > 0 && result.skipped > 0) {
        printSuccess(`Processed directory ${colorize(pathName, 'yellow')}`);
        printInfo(`Staged ${result.added} files, skipped ${result.skipped} files (identical to committed versions)`);
      } else if (result.added > 0) {
        printSuccess(`Added directory ${colorize(pathName, 'yellow')}`);
        printInfo(`Staged ${result.added} files`);
      } else if (result.skipped > 0) {
        printInfo(`All ${result.skipped} files in ${colorize(pathName, 'yellow')} are identical to committed versions - nothing staged`);
      } else {
        printInfo(`No files found in directory ${colorize(pathName, 'yellow')}`);
      }
      printInfo(`Total staged files: ${repo.listFiles().length}`);
    } else {
      // Handle single file
      const result = repo.addFileFromDisk(pathName, forceBinary);
      
      if (result.unchanged) {
        // File is identical to committed version - inform user
        printInfo(`File ${colorize(pathName, 'yellow')} is identical to committed version - nothing staged`);
        return;
      }
      
      const fileType = result.binary ? colorize('(binary)', 'yellow') : '(text)';
      printSuccess(`Staged ${colorize(pathName, 'yellow')} ${fileType}`);
      printInfo(`Staged files: ${repo.listFiles().length}`);
    }
  } catch (error) {
    printError(error.message);
  }
}

function cmdCommit(message) {
  if (!message) {
    printError('Usage: commit <message>');
    printInfo('Example: node webdvcs.js commit "Fix bug in login"');
    return;
  }
  
  try {
    if (debugMode) {
      console.log(`🔍 Debug mode enabled for commit`);
    }
    const commitResult = repo.commit(message, null, null, { debug: debugMode });
    printSuccess(`Created commit ${colorize(commitResult.commitHash, 'yellow')}`);
    printInfo(`Message: "${message}"`);
  } catch (error) {
    printError(error.message);
  }
}

function cmdStatus() {
  const status = repo.status();
  
  printHeader('Repository Status');
  
  console.log(`${colorize('Current branch:', 'bold')} ${colorize(status.current_branch, 'green')}`);
  console.log(`${colorize('HEAD commit:', 'bold')} ${status.head || colorize('(none)', 'yellow')}`);
  console.log(`${colorize('Database:', 'bold')} ${status.db_path} (${formatFileSize(status.db_size)})`);
  console.log(`${colorize('Stored chunks:', 'bold')} ${status.store_objects}`);
  console.log(`${colorize('Total branches:', 'bold')} ${status.branches}`);
  console.log('');
  
  if (status.staged.length > 0) {
    console.log(`${colorize('Staged files:', 'bold')}`);
    status.staged.forEach(fileName => {
      const fileContent = repo.getFile(fileName);
      console.log(`  ${colorize('•', 'green')} ${fileName} (${formatFileSize(fileContent.length)})`);
    });
    
    // Show summary AFTER file list
    const fileData = status.staged.map(fileName => {
      const fileContent = repo.getFile(fileName);
      const metadata = repo.store.getMeta('file_metadata') || {};
      return {
        name: fileName,
        size: fileContent.length,
        binary: metadata[fileName]?.binary || false
      };
    });
    
    const stats = analyzeFiles(fileData);
    
    console.log('');
    console.log(`${colorize('Staging Area Summary:', 'bold')}`);
    console.log(`${colorize('📊', 'blue')} Staged files: ${colorize(stats.total.toString(), 'bold')} total (${stats.textFiles} text, ${stats.binaryFiles} binary)`);
    console.log(`${colorize('💾', 'blue')} Total size: ${colorize(formatFileSize(stats.totalSize), 'bold')}`);
    if (stats.largestFile.name) {
      console.log(`${colorize('📈', 'blue')} Largest: ${colorize(stats.largestFile.name, 'yellow')} (${formatFileSize(stats.largestFile.size)})`);
    }
    
    // Show top 5 file extensions
    const topExts = Object.entries(stats.extensions)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5)
      .map(([ext, count]) => `.${ext} (${count})`)
      .join(', ');
    if (topExts) {
      console.log(`${colorize('📋', 'blue')} File types: ${topExts}`);
    }
  } else {
    console.log(`${colorize('No files staged', 'yellow')}`);
  }
  
  // Show files staged for deletion
  if (status.deleted && status.deleted.length > 0) {
    console.log('');
    console.log(`${colorize('Files staged for deletion:', 'bold')}`);
    status.deleted.forEach(fileName => {
      console.log(`  ${colorize('×', 'red')} ${colorize(fileName, 'red')}`);
    });
    console.log('');
    console.log(`${colorize('💀', 'red')} ${status.deleted.length} file(s) will be deleted on next commit`);
    console.log(`${colorize('ℹ️', 'blue')} Use 'unstage <file>' to cancel deletion`);
  }
}

function cmdLog(maxCount = 10) {
  const history = repo.log(maxCount);
  
  if (history.length === 0) {
    printInfo('No commits yet');
    return;
  }
  
  printHeader(`Commit History (showing ${history.length} commits)`);
  
  history.forEach((commit, index) => {
    const isLatest = index === 0;
    const prefix = isLatest ? colorize('● HEAD', 'green') : colorize('●', 'yellow');
    
    console.log(`${prefix} ${colorize(commit.hash, 'yellow')}`);
    console.log(`   ${colorize('Message:', 'bold')} ${commit.message}`);
    console.log(`   ${colorize('Author:', 'bold')} ${commit.author}`);
    console.log(`   ${colorize('Date:', 'bold')} ${new Date(commit.timestamp).toLocaleString()}`);
    if (commit.parent) {
      console.log(`   ${colorize('Parent:', 'bold')} ${commit.parent}`);
    }
    console.log('');
  });
}

function cmdAnalytics() {
  try {
    const analytics = repo.storageAnalytics();
    
    printHeader('Storage Analytics');
    
    // Database info
    console.log(`${colorize('📁 Database:', 'bold')}`);
    console.log(`   File: ${analytics.database.file_path}`);
    console.log(`   Size: ${colorize(analytics.database.file_size_mb + ' MB', 'cyan')} (${analytics.database.file_size_bytes.toLocaleString()} bytes)`);
    console.log('');
    
    // Chunk statistics
    console.log(`${colorize('🧩 Chunks:', 'bold')}`);
    console.log(`   Total chunks: ${colorize(analytics.chunks.total_count.toLocaleString(), 'cyan')}`);
    console.log(`   Data size: ${colorize(analytics.chunks.total_data_size_mb + ' MB', 'green')} (${analytics.chunks.total_data_size_bytes.toLocaleString()} bytes)`);
    console.log(`   Average chunk size: ${colorize(formatFileSize(analytics.chunks.avg_chunk_size_bytes), 'yellow')}`);
    console.log(`   Chunk size range: ${analytics.chunks.min_chunk_size_bytes} - ${analytics.chunks.max_chunk_size_bytes} bytes`);
    console.log('');
    
    // Size distribution
    if (analytics.size_distribution.length > 0) {
      console.log(`${colorize('📊 Chunk Size Distribution:', 'bold')}`);
      analytics.size_distribution.forEach(dist => {
        const percentage = analytics.chunks.total_count > 0 ? 
          ((dist.chunk_count / analytics.chunks.total_count) * 100).toFixed(1) : '0.0';
        console.log(`   ${dist.size_range.padEnd(8)}: ${colorize(dist.chunk_count.toString().padStart(6), 'cyan')} chunks (${percentage}%) - ${formatFileSize(dist.total_size)}`);
      });
      console.log('');
    }
    
    // Metadata info
    console.log(`${colorize('📋 Metadata:', 'bold')}`);
    console.log(`   Staging area: ${formatFileSize(analytics.metadata.staging_area_size_bytes)}`);
    console.log(`   File metadata: ${formatFileSize(analytics.metadata.file_metadata_size_bytes)}`);
    console.log('');
    
    // Efficiency metrics
    console.log(`${colorize('⚡ Storage Efficiency:', 'bold')}`);
    console.log(`   Data efficiency: ${colorize(analytics.efficiency.data_efficiency_percent + '%', 'green')}`);
    console.log(`   Storage overhead: ${colorize(analytics.efficiency.overhead_mb + ' MB', 'yellow')} (${analytics.efficiency.overhead_ratio}x data size)`);
    
    // Color-code efficiency
    const efficiency = parseFloat(analytics.efficiency.data_efficiency_percent);
    let efficiencyColor = 'red';
    if (efficiency > 80) efficiencyColor = 'green';
    else if (efficiency > 60) efficiencyColor = 'yellow';
    
    console.log(`   ${colorize('📈 Efficiency rating:', 'bold')} ${colorize(getEfficiencyRating(efficiency), efficiencyColor)}`);
    
  } catch (error) {
    printError(`Failed to get storage analytics: ${error.message}`);
  }
}

function getEfficiencyRating(efficiency) {
  if (efficiency >= 90) return 'Excellent (90%+)';
  if (efficiency >= 80) return 'Good (80-90%)';
  if (efficiency >= 60) return 'Fair (60-80%)';
  if (efficiency >= 40) return 'Poor (40-60%)';
  return 'Very Poor (<40%)';
}

function cmdUnstage(fileName) {
  if (!fileName) {
    printError('Usage: unstage <file>');
    printInfo('Example: node webdvcs.js myrepo unstage README.md');
    return;
  }
  
  try {
    const result = repo.unstage(fileName);
    
    switch (result.action) {
      case 'unstaged':
        printSuccess(`Unstaged ${colorize(fileName, 'yellow')}`);
        printInfo(`Staged files: ${repo.listFiles().length}`);
        break;
      case 'unremoved':
        printSuccess(`Canceled removal of ${colorize(fileName, 'yellow')}`);
        const status = repo.status();
        printInfo(`Files staged for deletion: ${status.deleted.length}`);
        break;
      case 'not_found':
        printError(`File not staged for addition or removal: ${fileName}`);
        break;
      case 'failed':
        printError(`Failed to unstage file: ${fileName}`);
        break;
      default:
        printError(`Unknown unstage result: ${result.action}`);
    }
  } catch (error) {
    printError(error.message);
  }
}

function cmdRm(fileName) {
  if (!fileName) {
    printError('Usage: rm <file>');
    printInfo('Example: node webdvcs.js myrepo rm old-file.txt');
    printInfo('This removes the file from the next commit (but preserves it in history)');
    return;
  }
  
  try {
    const result = repo.rm(fileName);
    if (result) {
      printSuccess(`Marked for removal: ${colorize(fileName, 'yellow')}`);
      printInfo('File will be removed from the next commit');
      printInfo(`Staged files: ${repo.listFiles().length}`);
    } else {
      printError(`File not found in repository or staging area: ${fileName}`);
    }
  } catch (error) {
    printError(error.message);
  }
}

function cmdReset(commitRef, mode) {
  if (!commitRef) {
    printError('Usage: reset <commit-ref> [--soft|--hard]');
    printInfo('Examples:');
    printInfo('  node webdvcs.js myrepo reset HEAD~1 --soft   # Undo last commit, keep staging');
    printInfo('  node webdvcs.js myrepo reset HEAD~2 --hard   # Undo 2 commits, clear staging');
    printInfo('  node webdvcs.js myrepo reset abc123 --hard   # Reset to specific commit');
    return;
  }
  
  // Parse reset mode
  let resetMode = 'soft'; // Default
  if (mode === '--hard') {
    resetMode = 'hard';
  } else if (mode === '--soft') {
    resetMode = 'soft';
  } else if (mode && !mode.startsWith('--')) {
    printError(`Invalid reset mode: ${mode}. Use --soft or --hard`);
    return;
  }
  
  try {
    const result = repo.reset(commitRef, { mode: resetMode });
    
    if (resetMode === 'soft') {
      printSuccess(`Soft reset to ${colorize(result.to, 'yellow')}`);
      printInfo('HEAD moved, staging area preserved');
    } else {
      printSuccess(`Hard reset to ${colorize(result.to, 'yellow')}`);
      printInfo('HEAD moved, staging area cleared and restored');
    }
    
    printInfo(`Branch: ${result.branch}`);
    printInfo(`Staged files: ${repo.listFiles().length}`);
    
  } catch (error) {
    printError(error.message);
  }
}

function cmdMerge(branchName) {
  if (!branchName) {
    printError('Usage: merge <branch-name>');
    printInfo('Example: node webdvcs.js myrepo merge feature-branch');
    printInfo('This merges the specified branch into the current branch');
    return;
  }
  
  try {
    const result = repo.merge(branchName);
    
    if (result.type === 'fast-forward') {
      printSuccess(`Fast-forward merge completed`);
      printInfo(`${colorize(repo.getCurrentBranch(), 'cyan')} → ${colorize(result.commitHash, 'yellow')}`);
      printInfo(result.message);
    } else if (result.type === 'three-way') {
      printSuccess(`Three-way merge completed`);
      printInfo(`Created merge commit: ${colorize(result.commitHash, 'yellow')}`);
      printInfo(result.message);
    } else if (result.type === 'up-to-date') {
      printInfo(`Already up-to-date`);
      printInfo(result.message);
    } else if (result.type === 'conflict') {
      printError(`Merge conflicts detected!`);
      printInfo(`Conflicts in ${result.conflicts.length} file(s):`);
      
      for (const conflict of result.conflicts) {
        console.log(`  ${colorize('×', 'red')} ${conflict.file}: ${conflict.message}`);
      }
      
      printInfo('Please resolve conflicts and commit manually');
      return;
    }
    
    printInfo(`Current branch: ${colorize(repo.getCurrentBranch(), 'cyan')}`);
    printInfo(`Repository files: ${repo.listRepoFiles().files.length}`);
    
  } catch (error) {
    printError(error.message);
  }
}

function cmdConfig(key, value) {
  if (!key) {
    // Show current config
    const author = repo.getAuthor();
    printInfo('Current configuration:');
    if (author.name) {
      console.log(`  author.name = ${colorize(author.name, 'green')}`);
    } else {
      console.log(`  author.name = ${colorize('(not set)', 'red')}`);
    }
    if (author.email) {
      console.log(`  author.email = ${colorize(author.email, 'green')}`);
    } else {
      console.log(`  author.email = ${colorize('(not set)', 'yellow')}`);
    }
    return;
  }
  
  if (!value) {
    printError('Usage: config <key> <value>');
    printInfo('Available keys:');
    printInfo('  author.name   - Your name for commits');
    printInfo('  author.email  - Your email for commits');
    return;
  }
  
  try {
    if (key === 'author.name') {
      const currentEmail = repo.getAuthor().email;
      repo.setAuthor(value, currentEmail);
      printSuccess(`Set author.name to ${colorize(value, 'green')}`);
    } else if (key === 'author.email') {
      const currentName = repo.getAuthor().name;
      if (!currentName) {
        printError('Set author.name first before setting email');
        return;
      }
      repo.setAuthor(currentName, value);
      printSuccess(`Set author.email to ${colorize(value, 'green')}`);
    } else {
      printError(`Unknown config key: ${key}`);
      printInfo('Available keys: author.name, author.email');
    }
  } catch (error) {
    printError(`Config failed: ${error.message}`);
  }
}

function cmdCheckout(commitHash, fileName) {
  if (!commitHash) {
    printError('Usage: checkout <commit-hash> [file]');
    printInfo('Examples:');
    printInfo('  checkout abc123          # Checkout entire commit');
    printInfo('  checkout abc123 file.txt # Checkout single file');
    return;
  }
  
  try {
    if (fileName) {
      // Single file checkout
      const result = repo.checkout(commitHash, fileName, true);
      printSuccess(`Checked out ${colorize(fileName, 'yellow')} from commit ${colorize(commitHash.substring(0, 8), 'yellow')}`);
      printInfo(`File size: ${formatFileSize(result.content.length)}`);
    } else {
      // Full commit checkout
      const result = repo.checkout(commitHash, null, true);
      const fileCount = Object.keys(result.files).length;
      
      printSuccess(`Checked out commit ${colorize(commitHash.substring(0, 8), 'yellow')}...`);
      printInfo(`Exported ${fileCount} files to current directory`);
      
      Object.entries(result.files).forEach(([fileName, content]) => {
        console.log(`  ${colorize('•', 'green')} ${fileName} (${formatFileSize(content.length)})`);
      });
    }
  } catch (error) {
    printError(error.message);
  }
}

function cmdLs(arg = '') {
  // Check if argument is a commit hash (64-character hex string)
  const isCommitHash = /^[a-f0-9]{64}$/i.test(arg);
  
  if (isCommitHash) {
    // List files in specific commit
    try {
      const files = repo.listCommitFiles(arg);
      if (files.length === 0) {
        printInfo(`No files in commit ${arg}`);
        return;
      }
      
      printHeader(`Files in Commit ${arg.substring(0, 8)}...`);
      files.forEach(fileName => {
        console.log(`${colorize('•', 'blue')} ${fileName}`);
      });
      console.log(`\n${colorize('📊', 'blue')} Total: ${files.length} files`);
      return;
    } catch (error) {
      printError(`Invalid commit hash: ${arg}`);
      return;
    }
  }
  
  // Handle as directory path (existing functionality)
  const repoContent = repo.listRepoFiles(arg);
  
  if (!repoContent.metadata.hasCommits) {
    const stagedFiles = repo.listFiles();
    if (stagedFiles.length === 0) {
      printInfo('No commits yet and no files staged');
      return;
    }
    
    printHeader('Staged Files (No commits yet)');
    console.log(`${colorize('Staged files:', 'bold')}`);
    stagedFiles.forEach(fileName => {
      const fileContent = repo.getFile(fileName);
      console.log(`${colorize('•', 'green')} ${fileName} (${formatFileSize(fileContent.length)})`);
    });
    
    // Show summary AFTER file list
    const fileData = stagedFiles.map(fileName => {
      const fileContent = repo.getFile(fileName);
      const metadata = repo.store.getMeta('file_metadata') || {};
      return {
        name: fileName,
        size: fileContent.length,
        binary: metadata[fileName]?.binary || false
      };
    });
    
    const stats = analyzeFiles(fileData);
    
    console.log('');
    console.log(`${colorize('Summary:', 'bold')}`);
    console.log(`${colorize('📊', 'blue')} Files: ${colorize(stats.total.toString(), 'bold')} total (${stats.textFiles} text, ${stats.binaryFiles} binary)`);
    console.log(`${colorize('💾', 'blue')} Total size: ${colorize(formatFileSize(stats.totalSize), 'bold')}`);
    if (stats.largestFile.name) {
      console.log(`${colorize('📈', 'blue')} Largest: ${colorize(stats.largestFile.name, 'yellow')} (${formatFileSize(stats.largestFile.size)})`);
    }
    
    // Show top 5 file extensions
    const topExts = Object.entries(stats.extensions)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5)
      .map(([ext, count]) => `.${ext} (${count})`)
      .join(', ');
    if (topExts) {
      console.log(`${colorize('📋', 'blue')} File types: ${topExts}`);
    }
    return;
  }
  
  const pathDisplay = repoContent.metadata.path ? 
    ` in ${colorize(repoContent.metadata.path, 'cyan')}` : 
    ' (repository root)';
  
  if (repoContent.files.length === 0 && repoContent.directories.length === 0) {
    printInfo(`No files or directories found${pathDisplay}`);
    return;
  }
  
  printHeader(`Repository Content${pathDisplay}`);
  
  // Show directories first, then files
  if (repoContent.directories.length > 0) {
    console.log(`${colorize('Directories:', 'bold')}`);
    repoContent.directories.forEach(dirName => {
      console.log(`${colorize('📁', 'blue')} ${colorize(dirName + '/', 'blue')}`);
    });
    
    if (repoContent.files.length > 0) {
      console.log('');
    }
  }
  
  if (repoContent.files.length > 0) {
    console.log(`${colorize('Files:', 'bold')}`);
    repoContent.files.forEach(file => {
      const fileType = file.binary ? colorize('(binary)', 'yellow') : '(text)';
      const sizeInfo = formatFileSize(file.size);
      console.log(`${colorize('📄', 'green')} ${file.name} ${fileType} (${sizeInfo})`);
    });
  }
  
  // Show summary AFTER file list for committed files
  if (repoContent.files.length > 0 || repoContent.directories.length > 0) {
    const stats = analyzeFiles(repoContent.files);
    
    console.log('');
    console.log(`${colorize('Summary:', 'bold')}`);
    console.log(`${colorize('📊', 'blue')} Files: ${colorize(stats.total.toString(), 'bold')} total (${stats.textFiles} text, ${stats.binaryFiles} binary)`);
    console.log(`${colorize('📁', 'blue')} Directories: ${colorize(repoContent.directories.length.toString(), 'bold')}`);
    console.log(`${colorize('💾', 'blue')} Total size: ${colorize(formatFileSize(stats.totalSize), 'bold')}`);
    if (stats.largestFile.name) {
      console.log(`${colorize('📈', 'blue')} Largest: ${colorize(stats.largestFile.name, 'yellow')} (${formatFileSize(stats.largestFile.size)})`);
    }
    
    // Show top 5 file extensions
    const topExts = Object.entries(stats.extensions)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5)
      .map(([ext, count]) => `.${ext} (${count})`)
      .join(', ');
    if (topExts) {
      console.log(`${colorize('📋', 'blue')} File types: ${topExts}`);
    }
  }
}

function cmdCat(fileName, commitHash) {
  if (!fileName) {
    printError('Usage: cat <file> [commit-hash]');
    printInfo('Examples:');
    printInfo('  cat file.txt           # View from staging/current');
    printInfo('  cat file.txt abc123    # View from specific commit');
    return;
  }
  
  try {
    const fileContent = repo.cat(fileName, commitHash);
    if (!fileContent) {
      if (commitHash) {
        printError(`File not found in commit ${commitHash}: ${fileName}`);
      } else {
        printError(`File not found in staging area or current commit: ${fileName}`);
      }
      return;
    }
    
    const header = commitHash ? 
      `Contents of ${fileName} from commit ${commitHash.substring(0, 8)}...` :
      `Contents of ${fileName}`;
    
    printHeader(header);
    console.log(new TextDecoder().decode(fileContent));
  } catch (error) {
    printError(error.message);
  }
}

function cmdBranch(branchName) {
  if (!branchName) {
    // List all branches
    const branches = repo.listBranches();
    
    if (branches.length === 0) {
      printInfo('No branches found');
      return;
    }
    
    printHeader('Branches');
    branches.forEach(branch => {
      const current = branch.isCurrent ? colorize('* ', 'green') : '  ';
      const nameColor = branch.isCurrent ? 'green' : 'white';
      const commitInfo = branch.commitHash ? ` (${branch.commitHash})` : colorize(' (empty)', 'yellow');
      console.log(`${current}${colorize(branch.name, nameColor)}${commitInfo}`);
    });
  } else {
    // Create new branch
    try {
      const newBranch = repo.createBranch(branchName);
      printSuccess(`Created branch ${colorize(newBranch, 'yellow')}`);
      printInfo(`Use "switch ${branchName}" to switch to this branch`);
    } catch (error) {
      printError(error.message);
    }
  }
}

function cmdSwitch(branchName) {
  if (!branchName) {
    printError('Usage: switch <branch-name>');
    return;
  }
  
  try {
    const currentBranch = repo.switchBranch(branchName);
    printSuccess(`Switched to branch ${colorize(currentBranch, 'green')}`);
    
    // Show staged files after switch
    const files = repo.listFiles();
    if (files.length > 0) {
      printInfo(`Staging area has ${files.length} files: ${files.join(', ')}`);
    } else {
      printInfo('Staging area is empty');
    }
  } catch (error) {
    printError(error.message);
  }
}

function cmdExport(branchName) {
  if (!branchName) {
    printError('Usage: export <branch-name>');
    printInfo('Example: node webdvcs.js myrepo export feature');
    printInfo('This exports the branch to a .webdvcs-branch file');
    return;
  }

  try {
    const result = repo.exportBranchToFile(branchName);
    const fs = require('fs');

    // Write the export data to file
    fs.writeFileSync(result.filename, result.data);

    printSuccess(`Exported branch ${colorize(branchName, 'yellow')} to ${colorize(result.filename, 'cyan')}`);
    printInfo(`File size: ${formatFileSize(result.data.length)}`);
    printInfo(`Use "import ${result.filename}" to import this branch to another repository`);

  } catch (error) {
    printError(`Export failed: ${error.message}`);
  }
}

function cmdImport(filename) {
  if (!filename) {
    printError('Usage: import <filename>');
    printInfo('Example: node webdvcs.js myrepo import feature-2024-01-01T12-00-00.webdvcs-branch');
    printInfo('This imports a branch from a .webdvcs-branch file');
    return;
  }

  const fs = require('fs');

  if (!fs.existsSync(filename)) {
    printError(`File not found: ${filename}`);
    return;
  }

  try {
    const fileData = fs.readFileSync(filename);
    const result = repo.importBranchFromFile(fileData);

    printSuccess(`Imported branch ${colorize(result.branch, 'yellow')} from ${colorize(filename, 'cyan')}`);
    printInfo(`Objects imported: ${result.objects_imported}`);
    if (result.skipped_existing > 0) {
      printInfo(`Skipped existing objects: ${result.skipped_existing}`);
    }
    printInfo(`Use "switch ${result.branch}" to switch to the imported branch`);

  } catch (error) {
    printError(`Import failed: ${error.message}`);
  }
}

function cmdDeleteBranch(branchName) {
  if (!branchName) {
    printError('Usage: delete-branch <branch-name>');
    printInfo('Example: node webdvcs.js myrepo delete-branch old-feature');
    printInfo('This deletes the branch and runs garbage collection to clean up unreachable objects');
    return;
  }

  try {
    const result = repo.deleteBranch(branchName);

    printSuccess(`Deleted branch ${colorize(branchName, 'yellow')}`);

    if (result.garbageCollection) {
      const gc = result.garbageCollection;
      printInfo(`Garbage collection: ${gc.deletedObjects} objects deleted out of ${gc.totalObjects} total (${gc.duration}ms)`);
      if (gc.deletedObjects > 0) {
        printInfo(`Freed space by removing ${gc.deletedObjects} unreachable objects`);
      } else {
        printInfo('No unreachable objects found');
      }
    }

  } catch (error) {
    printError(`Delete branch failed: ${error.message}`);
  }
}

function cmdDeleteCommit(commitHash) {
  if (!commitHash) {
    printError('Usage: delete-commit <commit-hash>');
    printInfo('Example: node webdvcs.js myrepo delete-commit abc123...');
    printInfo('This deletes a commit that is not referenced by any branch');
    return;
  }

  try {
    const result = repo.deleteCommit(commitHash);

    printSuccess(`Deleted commit ${colorize(commitHash.substring(0, 8), 'yellow')}`);

    if (result.garbageCollection) {
      const gc = result.garbageCollection;
      printInfo(`Garbage collection: ${gc.deletedObjects} objects deleted out of ${gc.totalObjects} total (${gc.duration}ms)`);
    }

  } catch (error) {
    printError(`Delete commit failed: ${error.message}`);
  }
}

function cmdGarbageCollect() {
  try {
    printInfo('Running garbage collection...');
    const result = repo.garbageCollect();

    printSuccess('Garbage collection completed');
    printInfo(`Total objects: ${result.totalObjects}`);
    printInfo(`Reachable objects: ${result.reachableObjects}`);
    printInfo(`Deleted objects: ${result.deletedObjects}`);
    printInfo(`Duration: ${result.duration}ms`);

    if (result.deletedObjects > 0) {
      printSuccess(`Freed space by removing ${result.deletedObjects} unreachable objects`);
    } else {
      printInfo('No unreachable objects found - repository is clean');
    }

  } catch (error) {
    printError(`Garbage collection failed: ${error.message}`);
  }
}

function cmdDiff(arg1, arg2) {
  if (!arg1) {
    printError('Usage: diff <file1> <file2> | <commit1> <commit2> | --staged');
    printInfo('Examples:');
    printInfo('  diff file1.txt file2.txt    # Compare two files');
    printInfo('  diff abc123 def456          # Compare two commits');
    printInfo('  diff --staged               # Show uncommitted changes');
    return;
  }
  
  try {
    if (arg1 === '--staged') {
      // Show uncommitted changes
      const changes = repo.showChanges();
      
      if (changes.length === 0) {
        printInfo('No staged changes');
        return;
      }
      
      printHeader('Uncommitted Changes');
      changes.forEach(change => {
        console.log(`\n${colorize(`File: ${change.file} (${change.type})`, 'cyan')}`);
        console.log(change.diff);
      });
      
    } else if (!arg2) {
      printError('Usage: diff <file1> <file2> | <commit1> <commit2> | --staged');
      return;
      
    } else {
      // Check if arguments are files or commits
      const isFile1 = repo.getFile(arg1) !== null;
      const isFile2 = repo.getFile(arg2) !== null;
      
      if (isFile1 && isFile2) {
        // Compare two files in staging area
        printHeader(`Diff: ${arg1} vs ${arg2}`);
        const diff = repo.diffFiles(arg1, arg2);
        console.log(diff);
        
      } else {
        // Assume they are commit hashes
        printHeader(`Diff: ${arg1} vs ${arg2}`);
        const commitDiff = repo.diffCommits(arg1, arg2);
        
        if (commitDiff.length === 0) {
          printInfo('No differences between commits');
          return;
        }
        
        commitDiff.forEach(change => {
          console.log(`\n${colorize(`File: ${change.file} (${change.type})`, 'cyan')}`);
          console.log(change.diff);
        });
      }
    }
    
  } catch (error) {
    printError(error.message);
  }
}

// Main CLI logic
function main() {
  const args = process.argv.slice(2);
  
  // Parse debug flag first
  debugMode = args.includes('--debug') || args.includes('-d');
  
  // Remove debug flag from args
  const cleanArgs = args.filter(arg => !['--debug', '-d'].includes(arg));
  
  if (cleanArgs.length === 0) {
    showHelp();
    return;
  }
  
  // Handle help command
  if (cleanArgs[0] === 'help' || cleanArgs[0] === '--help' || cleanArgs[0] === '-h') {
    showHelp();
    return;
  }
  
  // Handle init command: node webdvcs.js init <repo>
  if (cleanArgs[0] === 'init') {
    cmdInit(cleanArgs[1]);
    return;
  }
  
  // All other commands: node webdvcs.js <repo> <command> [args...]
  if (cleanArgs.length < 2) {
    printError('Repository name and command required');
    printInfo('Usage: node webdvcs.js <repo> <command> [args...]');
    printInfo('Example: node webdvcs.js myproject status');
    printInfo('Run "node webdvcs.js help" for more information');
    return;
  }
  
  const repoName = cleanArgs[0];
  const command = cleanArgs[1].toLowerCase();
  const commandArgs = cleanArgs.slice(2);
  
  // Convert repo name to sqlite filename and load repository
  const dbFile = repoName.endsWith('.sqlite') ? repoName : `${repoName}.sqlite`;
  
  if (!fs.existsSync(dbFile)) {
    printError(`Repository '${repoName}' not found (${dbFile})`);
    printInfo(`Create it with: node webdvcs.js init ${repoName}`);
    return;
  }
  
  currentDbFile = dbFile;
  repo = new MiniRepo(currentDbFile, debugMode);
  
  // Execute command
  switch (command) {
    case 'add':
      const forceBinary = commandArgs.includes('--binary');
      const fileName = commandArgs.find(arg => arg !== '--binary');
      cmdAdd(fileName, forceBinary);
      break;
    
    case 'commit':
      cmdCommit(commandArgs[0]);
      break;
    
    case 'status':
      cmdStatus();
      break;
    
    case 'log':
      cmdLog(commandArgs[0] ? parseInt(commandArgs[0]) : 10);
      break;
    
    case 'checkout':
      cmdCheckout(commandArgs[0], commandArgs[1]);
      break;
    
    case 'ls':
      cmdLs(commandArgs[0]);
      break;
    
    case 'cat':
      cmdCat(commandArgs[0], commandArgs[1]);
      break;
    
    case 'branch':
      cmdBranch(commandArgs[0]);
      break;
    
    case 'switch':
      cmdSwitch(commandArgs[0]);
      break;
    
    case 'diff':
      cmdDiff(commandArgs[0], commandArgs[1]);
      break;
    
    case 'analytics':
      cmdAnalytics();
      break;
    
    case 'unstage':
      cmdUnstage(commandArgs[0]);
      break;
    
    case 'rm':
      cmdRm(commandArgs[0]);
      break;
    
    case 'reset':
      cmdReset(commandArgs[0], commandArgs[1]);
      break;
    
    case 'merge':
      cmdMerge(commandArgs[0]);
      break;
    
    case 'config':
      cmdConfig(commandArgs[0], commandArgs[1]);
      break;

    case 'export':
      cmdExport(commandArgs[0]);
      break;

    case 'import':
      cmdImport(commandArgs[0]);
      break;

    case 'delete-branch':
      cmdDeleteBranch(commandArgs[0]);
      break;

    case 'delete-commit':
      cmdDeleteCommit(commandArgs[0]);
      break;

    case 'gc':
      cmdGarbageCollect();
      break;

    default:
      printError(`Unknown command: ${command}`);
      printInfo(`Available commands for repository '${repoName}': add, commit, status, log, checkout, ls, cat, branch, switch, diff, analytics, unstage, rm, reset, merge, config, export, import, delete-branch, delete-commit, gc`);
      printInfo('Run "node webdvcs.js help" for usage information');
  }
}

// Run CLI if called directly
if (require.main === module) {
  main();
}

// Export for testing
module.exports = { main, repo };