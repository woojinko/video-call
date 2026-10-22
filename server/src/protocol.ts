/**
 * Signaling protocol shared by server and client.
 *
 * NOTE: client/src/signaling/protocol.ts mirrors these types. Keep them in sync
 * (or extract a shared workspace package — a good Claude Code exercise).
 *
 * Flow for a 2-person room:
 *   A → join            server → A: joined { peerCount: 1 }        (A waits)
 *   B → join            server → B: joined { peerCount: 2 }
 *                       server → A: peer-joined                     (A is the caller)
 *   A → offer   ─relay→ B
 *   B → answer  ─relay→ A
 *   A/B → ice-candidate ─relay→ other side (trickle ICE, both directions)
 *   either → leave / socket close   server → other: peer-left
 */

export interface SessionDescription {
  type: 'offer' | 'answer';
  sdp: string;
}

export interface IceCandidate {
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

/** Messages a client sends to the server. */
export type ClientMessage =
  | { type: 'join'; roomId: string }
  | { type: 'offer'; sdp: SessionDescription }
  | { type: 'answer'; sdp: SessionDescription }
  | { type: 'ice-candidate'; candidate: IceCandidate }
  | { type: 'leave' };

/** Messages the server sends to a client. offer/answer/ice-candidate are relayed verbatim. */
export type ServerMessage =
  | { type: 'joined'; roomId: string; peerId: string; peerCount: number }
  | { type: 'peer-joined'; peerId: string }
  | { type: 'peer-left'; peerId: string }
  | { type: 'room-full'; roomId: string }
  | { type: 'error'; message: string }
  | { type: 'offer'; sdp: SessionDescription }
  | { type: 'answer'; sdp: SessionDescription }
  | { type: 'ice-candidate'; candidate: IceCandidate };

export const ROOM_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
export const MAX_MESSAGE_BYTES = 64 * 1024;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isSessionDescription(v: unknown, expected: 'offer' | 'answer'): v is SessionDescription {
  return isObject(v) && v.type === expected && typeof v.sdp === 'string';
}

function isIceCandidate(v: unknown): v is IceCandidate {
  return isObject(v) && typeof v.candidate === 'string';
}

/**
 * Parse and validate a raw WebSocket payload. Returns null for anything malformed,
 * so the server never trusts client input.
 */
export function parseClientMessage(raw: string): ClientMessage | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObject(data) || typeof data.type !== 'string') return null;

  switch (data.type) {
    case 'join':
      return typeof data.roomId === 'string' && ROOM_ID_PATTERN.test(data.roomId)
        ? { type: 'join', roomId: data.roomId }
        : null;
    case 'offer':
      return isSessionDescription(data.sdp, 'offer') ? { type: 'offer', sdp: data.sdp } : null;
    case 'answer':
      return isSessionDescription(data.sdp, 'answer') ? { type: 'answer', sdp: data.sdp } : null;
    case 'ice-candidate':
      return isIceCandidate(data.candidate) ? { type: 'ice-candidate', candidate: data.candidate } : null;
    case 'leave':
      return { type: 'leave' };
    default:
      return null;
  }
}
