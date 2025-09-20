/**
 * Delta Test Data Generator
 * Creates various test files and data patterns for comprehensive delta testing
 */

class DeltaTestDataGenerator {
  /**
   * Generate text file with specific size and pattern
   * @param {number} size - Size in bytes
   * @param {string} pattern - Pattern to use (sequential, random, repeated)
   * @returns {Uint8Array} Generated file data
   */
  generateTextFile(size, pattern = 'sequential') {
    const data = new Uint8Array(size);

    switch (pattern) {
      case 'sequential':
        for (let i = 0; i < size; i++) {
          data[i] = 32 + (i % 95); // Printable ASCII range
        }
        break;

      case 'random':
        for (let i = 0; i < size; i++) {
          data[i] = 32 + Math.floor(Math.random() * 95);
        }
        break;

      case 'repeated':
        const pattern_str = 'Hello World! This is a test pattern. ';
        const pattern_bytes = new TextEncoder().encode(pattern_str);
        for (let i = 0; i < size; i++) {
          data[i] = pattern_bytes[i % pattern_bytes.length];
        }
        break;

      default:
        throw new Error(`Unknown pattern: ${pattern}`);
    }

    return data;
  }

  /**
   * Generate binary file with specific size and random seed
   * @param {number} size - Size in bytes
   * @param {number} randomSeed - Seed for reproducible randomness
   * @returns {Uint8Array} Generated binary data
   */
  generateBinaryFile(size, randomSeed = 12345) {
    const data = new Uint8Array(size);

    // Simple seeded random number generator
    let seed = randomSeed;
    function random() {
      seed = (seed * 1664525 + 1013904223) % 0x100000000;
      return (seed >>> 0) / 0x100000000;
    }

    for (let i = 0; i < size; i++) {
      data[i] = Math.floor(random() * 256);
    }

    return data;
  }

  /**
   * Generate file with controlled changes from a base file
   * @param {Uint8Array} baseFile - Base file data
   * @param {string} changePattern - Type of changes (small, large, insertions, deletions)
   * @returns {Uint8Array} Modified file data
   */
  generateFileWithChanges(baseFile, changePattern) {
    const data = new Uint8Array(baseFile);

    switch (changePattern) {
      case 'small':
        // Change 1% of bytes randomly
        const changeCount = Math.max(1, Math.floor(data.length * 0.01));
        for (let i = 0; i < changeCount; i++) {
          const pos = Math.floor(Math.random() * data.length);
          data[pos] = Math.floor(Math.random() * 256);
        }
        break;

      case 'large':
        // Change 25% of bytes
        const largeChangeCount = Math.floor(data.length * 0.25);
        for (let i = 0; i < largeChangeCount; i++) {
          const pos = Math.floor(Math.random() * data.length);
          data[pos] = Math.floor(Math.random() * 256);
        }
        break;

      case 'insertions':
        // Insert data in middle
        const insertion = new TextEncoder().encode(' [INSERTED TEXT] ');
        const insertPos = Math.floor(data.length / 2);
        const newData = new Uint8Array(data.length + insertion.length);
        newData.set(data.slice(0, insertPos), 0);
        newData.set(insertion, insertPos);
        newData.set(data.slice(insertPos), insertPos + insertion.length);
        return newData;

      case 'deletions':
        // Delete section from middle
        const deleteStart = Math.floor(data.length * 0.4);
        const deleteEnd = Math.floor(data.length * 0.6);
        const deletedData = new Uint8Array(data.length - (deleteEnd - deleteStart));
        deletedData.set(data.slice(0, deleteStart), 0);
        deletedData.set(data.slice(deleteEnd), deleteStart);
        return deletedData;

      default:
        throw new Error(`Unknown change pattern: ${changePattern}`);
    }

    return data;
  }

  /**
   * Generate sequence of files with incremental changes
   * @param {Uint8Array} baseFile - Base file data
   * @param {number} changeCount - Number of versions to generate
   * @returns {Array<Uint8Array>} Array of file versions
   */
  generateFileSequence(baseFile, changeCount) {
    const sequence = [new Uint8Array(baseFile)];

    let currentFile = new Uint8Array(baseFile);
    for (let i = 0; i < changeCount; i++) {
      const changeType = ['small', 'large'][i % 2];
      currentFile = this.generateFileWithChanges(currentFile, changeType);
      sequence.push(new Uint8Array(currentFile));
    }

    return sequence;
  }

  /**
   * Generate source code-like file with realistic changes
   * @param {number} lineCount - Number of lines
   * @returns {Uint8Array} Generated source code
   */
  generateSourceCode(lineCount = 100) {
    const lines = [];
    const functions = ['process', 'calculate', 'validate', 'transform', 'execute'];
    const variables = ['data', 'result', 'input', 'output', 'config'];

    lines.push('/**');
    lines.push(' * Generated test source code');
    lines.push(' */');
    lines.push('');
    lines.push('class TestClass {');

    for (let i = 0; i < lineCount - 10; i++) {
      const func = functions[i % functions.length];
      const variable = variables[i % variables.length];

      if (i % 10 === 0) {
        lines.push('');
        lines.push(`  ${func}${variable.charAt(0).toUpperCase()}${variable.slice(1)}() {`);
      } else if (i % 10 === 9) {
        lines.push('  }');
      } else {
        lines.push(`    const ${variable} = this.${func}(${i});`);
      }
    }

    lines.push('}');
    lines.push('');
    lines.push('module.exports = TestClass;');

    return new TextEncoder().encode(lines.join('\n'));
  }

  /**
   * Generate large file with repeating patterns (good for delta compression)
   * @param {number} size - Target size in bytes
   * @returns {Uint8Array} Generated file with patterns
   */
  generateLargeFileWithPatterns(size) {
    const patterns = [
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit. ',
      'Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ',
      'Ut enim ad minim veniam, quis nostrud exercitation ullamco. ',
      'Duis aute irure dolor in reprehenderit in voluptate velit esse. '
    ];

    const data = new Uint8Array(size);
    let pos = 0;

    while (pos < size) {
      const pattern = patterns[Math.floor(Math.random() * patterns.length)];
      const patternBytes = new TextEncoder().encode(pattern);

      const copyLength = Math.min(patternBytes.length, size - pos);
      data.set(patternBytes.slice(0, copyLength), pos);
      pos += copyLength;
    }

    return data;
  }
}

module.exports = { DeltaTestDataGenerator };