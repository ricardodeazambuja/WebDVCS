/**
 * Test fixtures for browser tests - sample files and repositories
 */

// Sample text files for testing
export const testFiles = {
  'README.md': `# Test Repository
This is a test repository for WebDVCS browser interface testing.

## Features
- Version control
- Branch management  
- File operations
`,

  'src/main.js': `#!/usr/bin/env node

/**
 * Main application entry point
 */
console.log('Hello, WebDVCS!');

function main() {
  // Application logic here
  console.log('Starting application...');
}

if (require.main === module) {
  main();
}
`,

  'package.json': `{
  "name": "test-project",
  "version": "1.0.0",
  "description": "Test project for WebDVCS",
  "main": "src/main.js",
  "scripts": {
    "start": "node src/main.js",
    "test": "echo \\"No tests specified\\""
  },
  "author": "Test User",
  "license": "MIT"
}`,

  'docs/api.md': `# API Documentation

## WebDVCS API

### Repository Operations
- \`init()\` - Initialize repository
- \`add(file)\` - Add file to staging
- \`commit(message)\` - Create commit

### File Operations  
- \`upload(files)\` - Upload multiple files
- \`download(file)\` - Download single file
- \`remove(file)\` - Remove file from repository
`,

  'config/settings.json': `{
  "repository": {
    "name": "test-repo",
    "author": "Test User <test@example.com>",
    "defaultBranch": "main"
  },
  "ui": {
    "theme": "dark",
    "showLineNumbers": true,
    "wordWrap": true
  }
}`,

  'test.txt': 'Simple test file content\nWith multiple lines\nFor testing purposes\n',

  '.gitignore': `# Dependencies
node_modules/
*.log

# Build output
dist/
build/

# IDE
.vscode/
.idea/

# OS
.DS_Store
Thumbs.db
`,

  'CHANGELOG.md': `# Changelog

## v1.0.0 - Initial Release
- Basic VCS functionality
- Browser interface
- File management

## v0.9.0 - Beta Release  
- Core library implementation
- CLI interface
- Testing framework
`
};

// Binary test file (small PNG-like data)
export const binaryTestFile = new Uint8Array([
  0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
  0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR chunk header
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1 pixel
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4, // 8-bit RGBA
  0x89, 0x00, 0x00, 0x00, 0x0B, 0x49, 0x44, 0x41, // IDAT chunk
  0x54, 0x78, 0x9C, 0x62, 0xF8, 0x0F, 0x00, 0x00, // Compressed data
  0x00, 0x01, 0x00, 0x01, 0x46, 0x8A, 0x4A, 0xE5, // CRC
  0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, // IEND chunk
  0xAE, 0x42, 0x60, 0x82
]);

// Large test file content (for performance testing)
export function createLargeTestFile(sizeKB = 100) {
  const content = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(100);
  const repetitions = Math.ceil((sizeKB * 1024) / content.length);
  return content.repeat(repetitions);
}

// Expected file structure for testing
export const expectedFileStructure = [
  'README.md',
  'src/',
  'src/main.js', 
  'package.json',
  'docs/',
  'docs/api.md',
  'config/',
  'config/settings.json',
  'test.txt',
  '.gitignore',
  'CHANGELOG.md'
];

// Test scenarios for commits
export const commitScenarios = [
  {
    message: 'Initial commit',
    files: ['README.md', 'package.json'],
    author: 'Test User <test@example.com>'
  },
  {
    message: 'Add main application file',
    files: ['src/main.js'],
    author: 'Developer <dev@example.com>'
  },
  {
    message: 'Add documentation and configuration',
    files: ['docs/api.md', 'config/settings.json', '.gitignore'],
    author: 'Test User <test@example.com>'
  },
  {
    message: 'Update documentation',
    files: ['CHANGELOG.md'],
    author: 'Maintainer <maintainer@example.com>'
  }
];

// Branch testing scenarios
export const branchScenarios = [
  {
    name: 'feature/authentication',
    description: 'Add user authentication system'
  },
  {
    name: 'bugfix/file-upload',
    description: 'Fix file upload validation'
  },
  {
    name: 'release/v1.1.0',
    description: 'Prepare for version 1.1.0 release'
  }
];