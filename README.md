# WebDVCS

A distributed version control system that works both in the browser and command line, using SQLite for storage and Git-like workflows.

## Features

- **Dual Interface**: CLI for developers, web interface for teams
- **SQLite Storage**: Self-contained repositories in `.sqlite` files
- **Git-like Commands**: Familiar `add`, `commit`, `branch`, `merge` operations
- **Browser Compatible**: Full VCS functionality in any modern web browser
- **File Deduplication**: Automatic content-addressed storage
- **Delta Compression**: Efficient storage with librsync-style algorithms
- **Branch Management**: Create, switch, merge, and export branches
- **Cross-Platform**: Works on Windows, macOS, and Linux

## Quick Start

### CLI Usage

```bash
# Initialize a repository
node webdvcs.js init myproject

# Add files and commit
node webdvcs.js myproject add README.md
node webdvcs.js myproject commit "Initial commit"

# View status and history
node webdvcs.js myproject status
node webdvcs.js myproject log

# Branch operations
node webdvcs.js myproject branch feature
node webdvcs.js myproject switch feature
node webdvcs.js myproject merge main
```

### Web Interface

Open `webdvcs-browser.html` in your browser for a full GUI experience with:
- Repository creation and management
- File upload and staging
- Commit history visualization
- Branch operations
- Repository export/import

## Installation

### For CLI Use
```bash
git clone <repository-url>
cd webdvcs
npm install
```

### For Web Use
1. Clone the repository
2. Run `npm run build:github`
3. Serve the `dist/` directory with any web server
4. Open `index.html` in your browser

## Project Structure

- **CLI**: `webdvcs.js` - Command-line interface
- **Core Library**: `lib/core/` - Repository, storage, and VCS logic
- **Browser Interface**: `webdvcs-browser.html` - Web GUI
- **Tests**: `tests/` - Comprehensive test suite (11 modules, 6 browser tests)

## Commands Reference

| Command | Description |
|---------|-------------|
| `init <repo>` | Create or load repository |
| `add <path>` | Stage file or directory |
| `commit <message>` | Create commit |
| `status` | Show repository status |
| `log [count]` | View commit history |
| `branch [name]` | List or create branches |
| `switch <branch>` | Switch to branch |
| `merge <branch>` | Merge branch |
| `checkout <hash> [file]` | Checkout commit or file |
| `diff <file1> <file2>` | Compare files |
| `export <branch>` | Export branch to file |
| `import <file>` | Import branch from file |

Run `node webdvcs.js help` for complete command reference.

## Architecture

- **Storage**: SQLite database with content-addressed objects
- **Compression**: Delta compression for efficient storage
- **Deduplication**: Automatic file content deduplication
- **Browser Support**: WebAssembly SQLite via sql.js
- **Concurrency**: Web Workers for non-blocking operations

## Development

### Running Tests
```bash
npm test              # Core library tests (11 modules)
npm run test:browser  # Browser interface tests (6 tests)
npm run test:all      # All tests
```

### Building
```bash
npm run build         # Development build
npm run build:prod    # Production build
npm run build:github  # GitHub Pages build
```

### Local Development
```bash
npm run serve         # Start local server
npm run ci            # Full CI pipeline simulation
```

## Technical Specifications

- **Node.js**: v20+ required
- **Browser**: Modern browsers with WebAssembly support
- **Storage Format**: SQLite with custom VCS schema
- **Compression**: librsync-inspired delta algorithms
- **Performance**: O(n+m) delta compression, content deduplication
- **File Support**: Text and binary files, symlinks, directories

## License

ISC License - see package.json for details.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Run tests: `npm run ci`
4. Submit a pull request

All tests must pass before merging. The project maintains 100% test coverage across core functionality.