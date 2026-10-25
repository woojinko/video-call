// Mirror of server/src/protocol.ts — keep in sync.

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

export interface IceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

/** Body of `GET /ice-config` on the signaling server. */
export interface IceConfig {
  iceServers: IceServer[];
  iceTransportPolicy?: 'all' | 'relay';
}

export type ClientMessage =
  | { type: 'join'; roomId: string }
  | { type: 'offer'; sdp: SessionDescription }
  | { type: 'answer'; sdp: SessionDescription }
  | { type: 'ice-candidate'; candidate: IceCandidate }
  | { type: 'leave' };

export type ServerMessage =
  | { type: 'joined'; roomId: string; peerId: string; peerCount: number }
  | { type: 'peer-joined'; peerId: string }
  | { type: 'peer-left'; peerId: string }
  | { type: 'room-full'; roomId: string }
  | { type: 'error'; message: string }
  | { type: 'offer'; sdp: SessionDescription }
  | { type: 'answer'; sdp: SessionDescription }
  | { type: 'ice-candidate'; candidate: IceCandidate };
