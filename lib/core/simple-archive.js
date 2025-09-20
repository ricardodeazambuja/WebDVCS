/**
 * Simple Synchronous Archive Processing
 * Replaces the complex async archive-utils.js with a minimal implementation
 */

const zlib = require('zlib');

// Simple archive format detection
function isArchiveFile(data, filename) {
  if (!data || data.length < 4) return false;

  // Check ZIP signature (covers DOCX, XLSX, ODT, etc.)
  if (data[0] === 0x50 && data[1] === 0x4b && data[2] === 0x03 && data[3] === 0x04) {
    return true;
  }

  // Check by extension as fallback
  if (filename) {
    const ext = filename.toLowerCase();
    return ext.endsWith('.zip') || ext.endsWith('.docx') || ext.endsWith('.xlsx') ||
           ext.endsWith('.odt') || ext.endsWith('.ods') || ext.endsWith('.jar');
  }

  return false;
}

// Simple ZIP extraction - just get the files out
function extractZipFiles(data, archiveName) {
  const files = [];

  // Find central directory end record to get file count
  let eocdOffset = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 1000); i--) {
    if (data[i] === 0x50 && data[i+1] === 0x4b && data[i+2] === 0x05 && data[i+3] === 0x06) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset === -1) {
    throw new Error('Invalid ZIP file - no end of central directory');
  }

  // Read central directory info (create proper ArrayBuffer from Buffer)
  const properBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  const view = new DataView(properBuffer, eocdOffset);
  const totalEntries = view.getUint16(10, true);
  const centralDirOffset = view.getUint32(16, true);

  // Parse central directory entries
  let offset = centralDirOffset;
  for (let i = 0; i < totalEntries && i < 100; i++) { // Limit to 100 files
    if (data[offset] !== 0x50 || data[offset+1] !== 0x4b || data[offset+2] !== 0x01 || data[offset+3] !== 0x02) {
      break; // Invalid entry
    }

    const entryView = new DataView(properBuffer, offset);
    const filenameLength = entryView.getUint16(28, true);
    const extraLength = entryView.getUint16(30, true);
    const commentLength = entryView.getUint16(32, true);
    const localHeaderOffset = entryView.getUint32(42, true);

    // Get filename
    const filename = new TextDecoder().decode(data.slice(offset + 46, offset + 46 + filenameLength));

    // Skip directories
    if (!filename.endsWith('/')) {
      try {
        const fileContent = extractFileContent(data, localHeaderOffset);
        files.push({
          internalPath: filename,
          fullPath: `${archiveName}/${filename}`,
          content: fileContent,
          size: fileContent.length
        });
      } catch (error) {
        // Skip files we can't extract
      }
    }

    offset += 46 + filenameLength + extraLength + commentLength;
  }

  return files;
}

// Extract individual file content from ZIP
function extractFileContent(data, localHeaderOffset) {
  const properBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  const view = new DataView(properBuffer, localHeaderOffset);

  // Verify local file header signature
  if (view.getUint32(0, true) !== 0x04034b50) {
    throw new Error('Invalid local file header');
  }

  const compressionMethod = view.getUint16(8, true);
  const compressedSize = view.getUint32(18, true);
  const filenameLength = view.getUint16(26, true);
  const extraLength = view.getUint16(28, true);

  const dataOffset = localHeaderOffset + 30 + filenameLength + extraLength;
  const compressedData = data.slice(dataOffset, dataOffset + compressedSize);

  if (compressionMethod === 0) {
    // Stored (no compression)
    return compressedData;
  } else if (compressionMethod === 8) {
    // Deflate compression
    return zlib.inflateRawSync(compressedData);
  } else {
    throw new Error(`Unsupported compression method: ${compressionMethod}`);
  }
}

// Simple ZIP reconstruction - build it back
function reconstructZip(internalFiles) {
  const localFiles = [];
  const centralDir = [];
  let currentOffset = 0;

  // Build local file entries
  for (const file of internalFiles) {
    const filename = file.internalPath;
    const content = file.content;

    // Try compression
    let compressedData = content;
    let compressionMethod = 0;

    if (content.length > 100) {
      try {
        const deflated = zlib.deflateRawSync(content);
        if (deflated.length < content.length * 0.9) {
          compressedData = deflated;
          compressionMethod = 8;
        }
      } catch (e) {
        // Use stored if compression fails
      }
    }

    // Create local file header
    const header = Buffer.alloc(30 + filename.length);
    header.writeUInt32LE(0x04034b50, 0); // Signature
    header.writeUInt16LE(20, 4);          // Version
    header.writeUInt16LE(0, 6);           // Flags
    header.writeUInt16LE(compressionMethod, 8); // Compression
    header.writeUInt32LE(0, 10);          // CRC32 (simplified - use 0)
    header.writeUInt32LE(compressedData.length, 18); // Compressed size
    header.writeUInt32LE(content.length, 22);        // Uncompressed size
    header.writeUInt16LE(filename.length, 26);       // Filename length
    header.writeUInt16LE(0, 28);                     // Extra length
    header.write(filename, 30);

    localFiles.push(header, compressedData);

    // Create central directory entry
    const centralEntry = Buffer.alloc(46 + filename.length);
    centralEntry.writeUInt32LE(0x02014b50, 0);       // Signature
    centralEntry.writeUInt16LE(20, 4);               // Version made by
    centralEntry.writeUInt16LE(20, 6);               // Version needed
    centralEntry.writeUInt16LE(compressionMethod, 10); // Compression
    centralEntry.writeUInt32LE(compressedData.length, 20); // Compressed size
    centralEntry.writeUInt32LE(content.length, 24);         // Uncompressed size
    centralEntry.writeUInt16LE(filename.length, 28);        // Filename length
    centralEntry.writeUInt32LE(currentOffset, 42);          // Local header offset
    centralEntry.write(filename, 46);

    centralDir.push(centralEntry);
    currentOffset += header.length + compressedData.length;
  }

  // Create end of central directory
  const centralDirSize = centralDir.reduce((sum, entry) => sum + entry.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);        // Signature
  eocd.writeUInt16LE(internalFiles.length, 8);  // Total entries
  eocd.writeUInt16LE(internalFiles.length, 10); // Entries on disk
  eocd.writeUInt32LE(centralDirSize, 12);       // Central dir size
  eocd.writeUInt32LE(currentOffset, 16);        // Central dir offset

  // Combine everything
  return Buffer.concat([...localFiles, ...centralDir, eocd]);
}

module.exports = {
  isArchiveFile,
  extractZipFiles,
  reconstructZip
};