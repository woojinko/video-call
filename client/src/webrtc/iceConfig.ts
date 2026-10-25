import type { IceConfig, IceServer } from '../signaling/protocol';

const FETCH_TIMEOUT_MS = 3000;
// Reuse a prefetched config only while it's this fresh, so TURN credentials never go stale.
const PREFETCH_MAX_AGE_MS = 5 * 60_000;
const ICE_URL_PATTERN = /^(stun|stuns|turn|turns):\S+$/;

/** ws://host:port/prefix → http://host:port/prefix/ice-config (wss → https). */
export function iceConfigUrl(signalingUrl: string): string {
  const url = new URL(signalingUrl);
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
  url.pathname = url.pathname.replace(/\/*$/, '/ice-config');
  url.search = '';
  return url.toString();
}

function isIceServer(v: unknown): v is IceServer {
  if (typeof v !== 'object' || v === null) return false;
  const s = v as Record<string, unknown>;
  return (
    Array.isArray(s.urls) &&
    s.urls.length > 0 &&
    s.urls.every((u) => typeof u === 'string' && ICE_URL_PATTERN.test(u)) &&
    (s.username === undefined || typeof s.username === 'string') &&
    (s.credential === undefined || typeof s.credential === 'string')
  );
}

export function isIceConfig(v: unknown): v is IceConfig {
  if (typeof v !== 'object' || v === null) return false;
  const c = v as Record<string, unknown>;
  return (
    Array.isArray(c.iceServers) &&
    c.iceServers.every(isIceServer) &&
    (c.iceTransportPolicy === undefined || c.iceTransportPolicy === 'all' || c.iceTransportPolicy === 'relay')
  );
}

/**
 * Fetch STUN + short-lived TURN credentials from the signaling server. Throws on any failure:
 * silently falling back to public STUN would bypass TURN and a server-enforced relay-only policy.
 */
export async function fetchRtcConfig(signalingUrl: string): Promise<IceConfig> {
  const res = await fetch(iceConfigUrl(signalingUrl), { cache: 'no-store', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`GET /ice-config failed: HTTP ${res.status}`);
  const body: unknown = await res.json();
  if (!isIceConfig(body)) throw new Error('GET /ice-config returned an invalid config');
  return body;
}

/**
 * Prefetches the config (e.g. while the camera starts) so call setup doesn't wait on HTTP,
 * but falls back to a fresh fetch if the prefetch is old or failed.
 */
export class RtcConfigSource {
  private prefetched: { promise: Promise<IceConfig>; startedAt: number } | null = null;

  constructor(private readonly signalingUrl: string) {}

  prefetch(): void {
    const promise = fetchRtcConfig(this.signalingUrl);
    promise.catch(() => {}); // Handled in get(); don't report an unhandled rejection meanwhile.
    this.prefetched = { promise, startedAt: Date.now() };
  }

  /** Each prefetched config is handed out once. */
  get(): Promise<IceConfig> {
    const prefetched = this.prefetched;
    this.prefetched = null;
    if (prefetched && Date.now() - prefetched.startedAt < PREFETCH_MAX_AGE_MS) {
      return prefetched.promise.catch(() => fetchRtcConfig(this.signalingUrl));
    }
    return fetchRtcConfig(this.signalingUrl);
  }

  /** Always fetches; used for ICE restarts mid-call, when the original credentials may have expired. */
  fresh(): Promise<IceConfig> {
    return fetchRtcConfig(this.signalingUrl);
  }
}
