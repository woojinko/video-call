import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager, type Peer } from '../src/rooms.js';
import { parseClientMessage, type ServerMessage } from '../src/protocol.js';

function fakePeer(id: string): Peer & { inbox: ServerMessage[] } {
  const inbox: ServerMessage[] = [];
  return { id, inbox, send: (m) => inbox.push(m) };
}

test('first peer joins and waits; second peer triggers peer-joined on the first', () => {
  const rooms = new RoomManager();
  const a = fakePeer('a');
  const b = fakePeer('b');

  assert.equal(rooms.join(a, 'room1'), true);
  assert.deepEqual(a.inbox, [{ type: 'joined', roomId: 'room1', peerId: 'a', peerCount: 1 }]);

  assert.equal(rooms.join(b, 'room1'), true);
  assert.deepEqual(b.inbox, [{ type: 'joined', roomId: 'room1', peerId: 'b', peerCount: 2 }]);
  assert.deepEqual(a.inbox.at(-1), { type: 'peer-joined', peerId: 'b' });
});

test('third peer is rejected with room-full', () => {
  const rooms = new RoomManager();
  const [a, b, c] = ['a', 'b', 'c'].map(fakePeer);
  rooms.join(a, 'r');
  rooms.join(b, 'r');

  assert.equal(rooms.join(c, 'r'), false);
  assert.deepEqual(c.inbox, [{ type: 'room-full', roomId: 'r' }]);
  assert.equal(rooms.peerCount('r'), 2);
});

test('relay only reaches the other peer in the same room', () => {
  const rooms = new RoomManager();
  const [a, b, x] = ['a', 'b', 'x'].map(fakePeer);
  rooms.join(a, 'r1');
  rooms.join(b, 'r1');
  rooms.join(x, 'r2');
  for (const p of [a, b, x]) p.inbox.length = 0;

  const offer: ServerMessage = { type: 'offer', sdp: { type: 'offer', sdp: 'v=0' } };
  assert.equal(rooms.relay(a, offer), 1);
  assert.deepEqual(b.inbox, [offer]);
  assert.deepEqual(a.inbox, []);
  assert.deepEqual(x.inbox, []);
});

test('leaving notifies the remaining peer and cleans up empty rooms', () => {
  const rooms = new RoomManager();
  const [a, b] = ['a', 'b'].map(fakePeer);
  rooms.join(a, 'r');
  rooms.join(b, 'r');

  rooms.leave(b);
  assert.deepEqual(a.inbox.at(-1), { type: 'peer-left', peerId: 'b' });
  assert.equal(rooms.peerCount('r'), 1);

  rooms.leave(a);
  assert.equal(rooms.roomCount, 0);
});

test('parseClientMessage rejects malformed input', () => {
  assert.equal(parseClientMessage('not json'), null);
  assert.equal(parseClientMessage('{"type":"join"}'), null);
  assert.equal(parseClientMessage('{"type":"join","roomId":"bad room!"}'), null);
  assert.equal(parseClientMessage('{"type":"offer","sdp":{"type":"answer","sdp":"x"}}'), null);
  assert.equal(parseClientMessage('{"type":"nope"}'), null);
  assert.deepEqual(parseClientMessage('{"type":"join","roomId":"demo-1"}'), { type: 'join', roomId: 'demo-1' });
});
