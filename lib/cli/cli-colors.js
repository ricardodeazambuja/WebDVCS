/**
 * CLI Colors - ANSI terminal color codes for CLI interface
 */

// Colors for diff output
const diffColors = {
  added: '\x1b[32m',    // Green
  removed: '\x1b[31m',  // Red
  context: '\x1b[37m',  // White
  header: '\x1b[36m',   // Cyan
  binary: '\x1b[33m',   // Yellow
  reset: '\x1b[0m',
  bold: '\x1b[1m'
};

/**
 * Colorize text with ANSI codes
 * @param {string} text - Text to colorize
 * @param {string} color - Color name from diffColors
 * @returns {string} Colorized text
 */
function colorize(text, color) {
  return `${diffColors[color] || ''}${text}${diffColors.reset}`;
}

module.exports = {
  colorize,
  diffColors
};