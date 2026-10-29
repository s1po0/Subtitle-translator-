import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { unzip, safePath, findEntry } from '../server/zip.js';

/** Build a minimal zip in memory (store + deflate entries). */
function makeZip(entries) {
  const locals = [];
  const central = [];
  let offset = 0;

  for (const { name, data, method = 8 } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const payload = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
    const compressed = method === 8 ? deflateRawSync(payload) : payload;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(payload.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, compressed);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(method, 10);
    cen.writeUInt32LE(compressed.length, 20);
    cen.writeUInt32LE(payload.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt32LE(offset, 42);
    central.push(cen, nameBuf);

    offset += local.length + nameBuf.length + compressed.length;
  }

  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, centralBuf, eocd]);
}

test('unzip handles deflate and stored entries', () => {
  const zip = makeZip([
    { name: 'game/index.html', data: '<canvas></canvas>', method: 8 },
    { name: 'game/game.wasm', data: Buffer.from([0x00, 0x61, 0x73, 0x6d]), method: 0 },
    { name: 'game/', data: '', method: 0 },
  ]);
  const files = unzip(zip);
  assert.equal(files.length, 2, 'directory entries are skipped');
  assert.equal(files[0].name, 'game/index.html');
  assert.equal(files[0].data.toString(), '<canvas></canvas>');
  assert.deepEqual([...files[1].data], [0x00, 0x61, 0x73, 0x6d]);
});

test('unzip rejects non-zip input', () => {
  assert.throws(() => unzip(Buffer.from('not a zip at all')), /Not a zip|central/);
  assert.throws(() => unzip(Buffer.alloc(4)), /Not a zip/);
});

test('safePath strips traversal and windows separators', () => {
  assert.equal(safePath('../../etc/passwd'), 'etc/passwd');
  assert.equal(safePath('\\windows\\system32\\cmd.exe'), 'windows/system32/cmd.exe');
  assert.equal(safePath('/abs/index.html'), 'abs/index.html');
  assert.equal(safePath('./a/./b/../c'), 'a/c');
});

test('findEntry prefers the shallowest index.html', () => {
  assert.equal(findEntry(['build/index.html', 'build/game.wasm']), 'build/index.html');
  assert.equal(findEntry(['build/Game.html', 'build/game.wasm']), 'build/Game.html');
  assert.equal(findEntry(['a/b/deep.html', 'top.html']), 'top.html');
  assert.equal(findEntry(['game.wasm', 'game.pck']), null);
});
