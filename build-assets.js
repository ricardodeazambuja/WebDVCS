#!/usr/bin/env node
const fs = require('fs');

// Copy files
fs.copyFileSync('webdvcs-browser.html', 'dist/index.html');
fs.copyFileSync('styles.css', 'dist/styles.css');
fs.copyFileSync('webdvcs-browser.js', 'dist/webdvcs-ui.js');
fs.copyFileSync('favicon.ico', 'dist/favicon.ico');

// Copy and fix worker file
let workerContent = fs.readFileSync('webdvcs-worker.js', 'utf8');
workerContent = workerContent.replace('dist/webdvcs-browser.js', 'webdvcs-browser.js');
fs.writeFileSync('dist/webdvcs-worker.js', workerContent);

// Fix HTML script references
let html = fs.readFileSync('dist/index.html', 'utf8');
html = html.replace('src="dist/webdvcs-browser.js"', 'src="webdvcs-browser.js"');
html = html.replace(/src="webdvcs-browser\.js"(\s*><\/script>\s*<\/body>)/m, 'src="webdvcs-ui.js"$1');
fs.writeFileSync('dist/index.html', html);

console.log('✅ Assets copied and paths fixed');