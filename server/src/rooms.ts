import type { ServerMessage } from './protocol.js';

/** Anything we can send signaling messages to. Abstracted so RoomManager is unit-testable without sockets. */
export interface Peer {
  readonly id: string;
  send(message: ServerMessage): void;
}

/**
 * Pure room bookkeeping: who is in which room, and fan-out of messages.
 * Rooms are capped (default 2) because this is a 1-on-1 call.
 */
export class RoomManager {
  private readonly rooms = new Map<string, Map<string, Peer>>();
  private readonly roomByPeer = new Map<string, string>();

  constructor(private readonly maxPeersPerRoom = 2) {}

  join(peer: Peer, roomId: string): boolean {
    // Re-joining (or switching rooms) leaves the previous room first.
    if (this.roomByPeer.has(peer.id)) this.leave(peer);

    const room = this.rooms.get(roomId) ?? new Map<string, Peer>();
    if (room.size >= this.maxPeersPerRoom) {
      peer.send({ type: 'room-full', roomId });
      return false;
    }

    room.set(peer.id, peer);
    this.rooms.set(roomId, room);
    this.roomByPeer.set(peer.id, roomId);

    peer.send({ type: 'joined', roomId, peerId: peer.id, peerCount: room.size });
    for (const other of room.values()) {
      if (other.id !== peer.id) other.send({ type: 'peer-joined', peerId: peer.id });
    }
    return true;
  }

  /** Forward a message to everyone else in the sender's room. Returns how many peers received it. */
  relay(from: Peer, message: ServerMessage): number {
    const roomId = this.roomByPeer.get(from.id);
    if (!roomId) return 0;
    const room = this.rooms.get(roomId);
    if (!room) return 0;

    let delivered = 0;
    for (const other of room.values()) {
      if (other.id === from.id) continue;
      other.send(message);
      delivered++;
    }
    return delivered;
  }

  leave(peer: Peer): void {
    const roomId = this.roomByPeer.get(peer.id);
    if (!roomId) return;
    this.roomByPeer.delete(peer.id);

    const room = this.rooms.get(roomId);
    if (!room) return;
    room.delete(peer.id);

    for (const other of room.values()) other.send({ type: 'peer-left', peerId: peer.id });
    if (room.size === 0) this.rooms.delete(roomId);
  }

  roomOf(peerId: string): string | undefined {
    return this.roomByPeer.get(peerId);
  }

  peerCount(roomId: string): number {
    return this.rooms.get(roomId)?.size ?? 0;
  }

  get roomCount(): number {
    return this.rooms.size;
  }
}
