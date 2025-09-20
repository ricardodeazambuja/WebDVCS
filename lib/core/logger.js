/**
 * WebDVCS Logging Framework
 * Lightweight, performance-optimized logging with configurable levels
 */

class Logger {
  constructor(name, level = 'INFO') {
    this.name = name;
    this.setLevel(level);
  }

  setLevel(level) {
    const envLevel = (typeof process !== 'undefined' && process.env) ?
                     process.env.WEBDVCS_LOG_LEVEL : null;
    const effectiveLevel = envLevel || level;

    this.level = this.getLevelValue(effectiveLevel);
    this.levelName = effectiveLevel;

    // Performance optimization - disable methods completely if level too high
    this.optimizeMethods();
  }

  getLevelValue(level) {
    const levels = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, SILENT: 4 };
    return levels[level.toUpperCase()] ?? 1; // Default to INFO
  }

  optimizeMethods() {
    // Zero-cost logging when disabled - replace methods with no-ops
    if (this.level > 0) {
      this.debug = () => {}; // No-op function
    }
    if (this.level > 1) {
      this.info = () => {};
    }
    if (this.level > 2) {
      this.warn = () => {};
    }
    if (this.level > 3) {
      this.error = () => {};
    }
  }

  debug(message, metadata = null) {
    if (this.level <= 0) this.log('DEBUG', message, metadata);
  }

  info(message, metadata = null) {
    if (this.level <= 1) this.log('INFO', message, metadata);
  }

  warn(message, metadata = null) {
    if (this.level <= 2) this.log('WARN', message, metadata);
  }

  error(message, metadata = null) {
    if (this.level <= 3) this.log('ERROR', message, metadata);
  }

  log(level, message, metadata) {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] ${level} [${this.name}]`;

    if (metadata) {
      // Structured logging with metadata
      const metadataStr = typeof metadata === 'object' ?
        Object.entries(metadata).map(([k, v]) => `${k}=${v}`).join(' ') :
        metadata;
      console.log(`${prefix} ${message} ${metadataStr}`);
    } else {
      console.log(`${prefix} ${message}`);
    }
  }
}

/**
 * Factory function for consistent logger creation
 * @param {string} name - Logger name (usually module name)
 * @returns {Logger} Configured logger instance
 */
function createLogger(name) {
  // Environment-aware default levels
  let defaultLevel = 'INFO';

  if (typeof process !== 'undefined' && process.env) {
    if (process.env.NODE_ENV === 'production') {
      defaultLevel = 'WARN';
    } else if (process.env.NODE_ENV === 'development') {
      defaultLevel = 'DEBUG';
    }
  }

  // Browser compatibility - minimal logging in browser
  if (typeof window !== 'undefined') {
    defaultLevel = 'ERROR';
  }

  return new Logger(name, defaultLevel);
}

/**
 * Create logger with specific level (for testing)
 * @param {string} name - Logger name
 * @param {string} level - Log level
 * @returns {Logger} Logger instance
 */
function createLoggerWithLevel(name, level) {
  return new Logger(name, level);
}

/**
 * Set global log level for all future loggers
 * @param {string} level - Log level (DEBUG, INFO, WARN, ERROR, SILENT)
 */
function setGlobalLogLevel(level) {
  if (typeof process !== 'undefined' && process.env) {
    process.env.WEBDVCS_LOG_LEVEL = level;
  }
}

module.exports = {
  Logger,
  createLogger,
  createLoggerWithLevel,
  setGlobalLogLevel
};