import type { IceConfig } from '../signaling/protocol';

// Used only if the signaling server's /ice-config can't be reached.
const FALLBACK_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }],
};

/** ws://host:port → http://host:port/ice-config (wss → https). */
export function iceConfigUrl(signalingUrl: string): string {
  const url = new URL('/ice-config', signalingUrl);
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
  return url.toString();
}

/**
 * Fetch STUN + short-lived TURN credentials from the signaling server.
 * Called per peer connection so credentials are always fresh.
 */
export async function fetchRtcConfig(signalingUrl: string): Promise<RTCConfiguration> {
  try {
    const res = await fetch(iceConfigUrl(signalingUrl), { cache: 'no-store', signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const config = (await res.json()) as IceConfig;
    return config;
  } catch (err) {
    console.warn('[webrtc] could not load ICE config, falling back to public STUN:', err);
    return FALLBACK_CONFIG;
  }
}
