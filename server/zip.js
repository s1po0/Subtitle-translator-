/**
 * Minimal ZIP reader for Godot web exports.
 *
 * Supports the two methods every exporter/OS archiver uses (store and deflate)
 * and ignores directory entries, symlinks and archives without a central
 * directory. Deliberately dependency-free so the dev/preview server can accept
 * an export zip without adding a native or npm dependency.
 */
import { inflateRawSync } from 'node:zlib';

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;

function findEndOfCentralDirectory(buffer) {
  const min = Math.max(0, buffer.length - 0xffff - 22);
  for (let offset = buffer.length - 22; offset >= min; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD_SIG) return offset;
  }
  return -1;
}

/**
 * @param {Buffer} buffer
 * @returns {Array<{name:string, data:Buffer}>}
 */
export function unzip(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22) throw new Error('Not a zip archive');
  const eocd = findEndOfCentralDirectory(buffer);
  if (eocd === -1) throw new Error('Zip end-of-central-directory record not found');

  const entries = buffer.readUInt16LE(eocd + 10);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  if (entries === 0) return [];
  if (centralOffset >= buffer.length) throw new Error('Corrupt zip central directory');

  const files = [];
  let cursor = centralOffset;

  for (let i = 0; i < entries; i += 1) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== CEN_SIG) break;
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    cursor += 46 + nameLength + extraLength + commentLength;

    if (name.endsWith('/')) continue; // directory entry
    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== LOC_SIG) continue;

    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = buffer.subarray(dataStart, dataStart + compressedSize);

    let data;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) {
      data = uncompressedSize === 0 ? Buffer.alloc(0) : inflateRawSync(raw);
    } else continue; // unsupported (bzip2, lzma, zstd…)

    files.push({ name, data });
  }

  return files;
}

/**
 * Normalise a zip member name: resolve `.`/`..` (clamped at the root), strip
 * leading slashes and convert Windows separators. Nothing can escape the
 * destination directory after this.
 */
export function safePath(name) {
  const stack = [];
  for (const part of String(name).replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  return stack.join('/');
}

/**
 * Find the entry document of a Godot web export.
 * @param {string[]} names
 */
export function findEntry(names) {
  const html = names.filter((name) => /\.html?$/i.test(name));
  if (!html.length) return null;
  const shallowest = html.sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))[0];
  if (/^index\.html?$/i.test(shallowest.split('/').pop())) return shallowest;
  return shallowest;
}
