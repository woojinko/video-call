import { createHmac } from 'node:crypto';
import type { IceConfig, IceServer } from './protocol.js';

export const DEFAULT_STUN_URLS = ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'];
const DEFAULT_TURN_TTL_SECONDS = 3600;

export interface TurnOptions {
  urls: string[];
  /** Shared with coturn's `static-auth-secret`. Never sent to clients. */
  secret: string;
  ttlSeconds: number;
}

export interface IceOptions {
  stunUrls: string[];
  turn?: TurnOptions;
  /** Force every call through TURN (iceTransportPolicy: 'relay'). Useful to prove TURN works. */
  relayOnly: boolean;
}

export const DEFAULT_ICE_OPTIONS: IceOptions = { stunUrls: DEFAULT_STUN_URLS, relayOnly: false };

const STUN_URL_PATTERN = /^stuns?:\S+$/;
const TURN_URL_PATTERN = /^turns?:\S+$/;

function splitList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Read ICE settings from environment variables. Throws on a half-configured TURN setup. */
export function iceOptionsFromEnv(env: Record<string, string | undefined>): IceOptions {
  const stunUrls = env.STUN_URLS === undefined ? DEFAULT_STUN_URLS : splitList(env.STUN_URLS);
  const turnUrls = splitList(env.TURN_URLS);
  const secret = env.TURN_SECRET ?? '';
  const relayOnly = env.ICE_TRANSPORT_POLICY === 'relay';

  // A bad URL would make every client's RTCPeerConnection constructor throw, so fail at startup instead.
  for (const url of stunUrls) {
    if (!STUN_URL_PATTERN.test(url)) throw new Error(`STUN_URLS entry must start with stun: or stuns:, got "${url}"`);
  }
  for (const url of turnUrls) {
    if (!TURN_URL_PATTERN.test(url)) throw new Error(`TURN_URLS entry must start with turn: or turns:, got "${url}"`);
  }

  if (env.ICE_TRANSPORT_POLICY !== undefined && env.ICE_TRANSPORT_POLICY !== 'relay' && env.ICE_TRANSPORT_POLICY !== 'all') {
    throw new Error(`ICE_TRANSPORT_POLICY must be "all" or "relay", got "${env.ICE_TRANSPORT_POLICY}"`);
  }
  if (turnUrls.length > 0 !== (secret !== '')) {
    throw new Error('TURN_URLS and TURN_SECRET must be set together');
  }
  if (relayOnly && turnUrls.length === 0) {
    throw new Error('ICE_TRANSPORT_POLICY=relay needs a TURN server (TURN_URLS + TURN_SECRET)');
  }

  let ttlSeconds = DEFAULT_TURN_TTL_SECONDS;
  if (env.TURN_TTL_SECONDS !== undefined) {
    ttlSeconds = Number(env.TURN_TTL_SECONDS);
    if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
      throw new Error(`TURN_TTL_SECONDS must be a positive integer, got "${env.TURN_TTL_SECONDS}"`);
    }
  }

  return {
    stunUrls,
    turn: turnUrls.length > 0 ? { urls: turnUrls, secret, ttlSeconds } : undefined,
    relayOnly,
  };
}

/**
 * Build the RTCConfiguration a client should use. TURN credentials follow the
 * coturn REST API scheme (`use-auth-secret`): username = "<expiry unix seconds>:<user>",
 * credential = base64(HMAC-SHA1(secret, username)). coturn recomputes the HMAC and
 * rejects expired usernames, so the secret never leaves the server.
 */
export function buildIceConfig(options: IceOptions, nowMs: number): IceConfig {
  const iceServers: IceServer[] = [];
  if (options.stunUrls.length > 0) iceServers.push({ urls: options.stunUrls });

  if (options.turn) {
    const expiry = Math.floor(nowMs / 1000) + options.turn.ttlSeconds;
    const username = `${expiry}:video-call`;
    const credential = createHmac('sha1', options.turn.secret).update(username).digest('base64');
    iceServers.push({ urls: options.turn.urls, username, credential });
  }

  return options.relayOnly ? { iceServers, iceTransportPolicy: 'relay' } : { iceServers };
}
