import test from 'node:test';
import assert from 'node:assert/strict';
import { normaliseSignallingUrl, isLikelyMixedContent } from '../src/unreal.js';

test('accepts bare host:port and adds ws://', () => {
  assert.equal(normaliseSignallingUrl('localhost:8888'), 'ws://localhost:8888');
  assert.equal(normaliseSignallingUrl(' 127.0.0.1:8888 '), 'ws://127.0.0.1:8888');
});

test('keeps ws/wss and drops trailing slashes', () => {
  assert.equal(normaliseSignallingUrl('ws://localhost:8888/'), 'ws://localhost:8888');
  assert.equal(normaliseSignallingUrl('wss://stream.example.com/'), 'wss://stream.example.com');
  assert.equal(normaliseSignallingUrl('wss://example.com/ps/signal'), 'wss://example.com/ps/signal');
});

test('maps https/http URLs to wss/ws', () => {
  assert.equal(normaliseSignallingUrl('https://random.trycloudflare.com'), 'wss://random.trycloudflare.com');
  assert.equal(normaliseSignallingUrl('http://1.2.3.4:8888'), 'ws://1.2.3.4:8888');
});

test('rejects empty and non-websocket input', () => {
  assert.equal(normaliseSignallingUrl(''), null);
  assert.equal(normaliseSignallingUrl('   '), null);
  assert.equal(normaliseSignallingUrl('ftp://example.com'), null);
  assert.equal(normaliseSignallingUrl('ws://'), null);
});

test('flags insecure ws from an https page, except loopback', () => {
  assert.equal(isLikelyMixedContent('ws://8.8.8.8:8888', 'https:'), true);
  assert.equal(isLikelyMixedContent('ws://localhost:8888', 'https:'), false);
  assert.equal(isLikelyMixedContent('ws://127.0.0.1:8888', 'https:'), false);
  assert.equal(isLikelyMixedContent('wss://example.com', 'https:'), false);
  assert.equal(isLikelyMixedContent('ws://example.com', 'http:'), false);
});
