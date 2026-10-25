import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { buildIceConfig, DEFAULT_STUN_URLS, iceOptionsFromEnv } from '../src/ice.js';

test('without TURN env vars: public STUN only, no relay policy', () => {
  const options = iceOptionsFromEnv({});
  assert.equal(options.turn, undefined);
  assert.deepEqual(buildIceConfig(options, 0), { iceServers: [{ urls: DEFAULT_STUN_URLS }] });
});

test('TURN credentials follow the coturn REST API scheme and expire after the TTL', () => {
  const options = iceOptionsFromEnv({
    STUN_URLS: '',
    TURN_URLS: 'turn:turn.example.com:3478?transport=udp, turn:turn.example.com:3478?transport=tcp',
    TURN_SECRET: 's3cret',
    TURN_TTL_SECONDS: '600',
  });
  const now = Date.UTC(2026, 0, 1);
  const config = buildIceConfig(options, now);

  assert.equal(config.iceServers.length, 1, 'empty STUN_URLS disables STUN');
  const [turn] = config.iceServers;
  assert.deepEqual(turn?.urls, ['turn:turn.example.com:3478?transport=udp', 'turn:turn.example.com:3478?transport=tcp']);

  const expiry = now / 1000 + 600;
  assert.equal(turn?.username, `${expiry}:video-call`);
  assert.equal(turn?.credential, createHmac('sha1', 's3cret').update(`${expiry}:video-call`).digest('base64'));
  assert.equal(JSON.stringify(config).includes('s3cret'), false, 'the shared secret is never sent to clients');
});

test('relay-only policy is passed through to the client', () => {
  const options = iceOptionsFromEnv({ TURN_URLS: 'turn:localhost:3478', TURN_SECRET: 'x', ICE_TRANSPORT_POLICY: 'relay' });
  assert.equal(buildIceConfig(options, 0).iceTransportPolicy, 'relay');
});

test('half-configured or invalid TURN settings fail at startup', () => {
  assert.throws(() => iceOptionsFromEnv({ TURN_URLS: 'turn:localhost:3478' }), /set together/);
  assert.throws(() => iceOptionsFromEnv({ TURN_SECRET: 'x' }), /set together/);
  assert.throws(() => iceOptionsFromEnv({ ICE_TRANSPORT_POLICY: 'relay' }), /needs a TURN server/);
  assert.throws(() => iceOptionsFromEnv({ ICE_TRANSPORT_POLICY: 'turn' }), /"all" or "relay"/);
  assert.throws(
    () => iceOptionsFromEnv({ TURN_URLS: 'turn:localhost:3478', TURN_SECRET: 'x', TURN_TTL_SECONDS: '0' }),
    /positive integer/,
  );
});
