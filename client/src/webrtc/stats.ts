// Pure helpers that turn RTCPeerConnection.getStats() reports into the numbers the stats overlay shows.
// Counters in a report (bytes, packets) are cumulative, so rates come from the change between two
// reports taken about a second apart.

/** What getStats() resolves to. RTCStatsReport is a ReadonlyMap; tests pass a plain Map. */
export type StatsReportLike = ReadonlyMap<string, unknown>;

export type CandidateType = 'host' | 'srflx' | 'prflx' | 'relay';

export interface VideoStreamStats {
  bitrateKbps: number | null;
  framesPerSecond: number | null;
  frameWidth: number | null;
  frameHeight: number | null;
}

export interface CallStats {
  roundTripTimeMs: number | null;
  /** Inbound packets lost in the last interval, audio and video together. */
  packetLossPercent: number | null;
  /** The ICE candidate pair media is actually flowing over. */
  candidatePair: {
    localType: CandidateType | null;
    remoteType: CandidateType | null;
    protocol: string | null;
  } | null;
  outboundVideo: VideoStreamStats | null;
  inboundVideo: VideoStreamStats | null;
}

interface StatsEntry {
  id: string;
  type: string;
  timestamp: number;
  [key: string]: unknown;
}

function isEntry(value: unknown): value is StatsEntry {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === 'string' && typeof v.type === 'string' && typeof v.timestamp === 'number';
}

function entries(report: StatsReportLike): StatsEntry[] {
  const result: StatsEntry[] = [];
  for (const value of report.values()) if (isEntry(value)) result.push(value);
  return result;
}

function num(entry: StatsEntry | undefined, key: string): number | null {
  const value = entry?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function str(entry: StatsEntry | undefined, key: string): string | null {
  const value = entry?.[key];
  return typeof value === 'string' ? value : null;
}

function candidateType(entry: StatsEntry | undefined): CandidateType | null {
  const value = str(entry, 'candidateType');
  return value === 'host' || value === 'srflx' || value === 'prflx' || value === 'relay' ? value : null;
}

function lookup(report: StatsReportLike, id: string | null): StatsEntry | undefined {
  if (id === null) return undefined;
  const value = report.get(id);
  return isEntry(value) ? value : undefined;
}

/**
 * The candidate pair in use. Chrome and Safari name it on the transport entry; Firefox marks the
 * pair itself with `selected`. As a last resort, take a nominated pair that succeeded.
 */
export function findSelectedCandidatePair(report: StatsReportLike): StatsEntry | undefined {
  const all = entries(report);
  for (const transport of all.filter((e) => e.type === 'transport')) {
    const pair = lookup(report, str(transport, 'selectedCandidatePairId'));
    if (pair) return pair;
  }
  const pairs = all.filter((e) => e.type === 'candidate-pair');
  return (
    pairs.find((p) => p.selected === true) ?? pairs.find((p) => p.nominated === true && p.state === 'succeeded')
  );
}

/** Bits per second → kbps from two readings of a cumulative byte counter. Null if it can't be trusted. */
export function bitrateKbps(
  bytesNow: number | null,
  timestampNowMs: number,
  bytesBefore: number | null,
  timestampBeforeMs: number,
): number | null {
  if (bytesNow === null || bytesBefore === null) return null;
  const elapsedMs = timestampNowMs - timestampBeforeMs;
  const bytes = bytesNow - bytesBefore;
  // A negative delta means the counter restarted (e.g. a new peer connection reusing stat ids).
  if (elapsedMs <= 0 || bytes < 0) return null;
  return (bytes * 8) / elapsedMs; // bits per ms = kbps
}

/** Share of packets lost between two readings, in percent. Null when nothing was expected. */
export function packetLossPercent(
  lostNow: number,
  receivedNow: number,
  lostBefore: number,
  receivedBefore: number,
): number | null {
  // packetsLost can go down when late duplicates arrive; never report negative loss.
  const lost = Math.max(0, lostNow - lostBefore);
  const received = receivedNow - receivedBefore;
  if (received < 0) return null;
  const expected = lost + received;
  return expected === 0 ? null : (lost / expected) * 100;
}

function videoRtp(report: StatsReportLike, type: 'inbound-rtp' | 'outbound-rtp'): StatsEntry | undefined {
  // One video stream each way here (no simulcast), so the first one is the one.
  return entries(report).find((e) => e.type === type && e.kind === 'video');
}

function videoStreamStats(
  current: StatsEntry | undefined,
  previous: StatsReportLike | null,
  bytesKey: 'bytesSent' | 'bytesReceived',
): VideoStreamStats | null {
  if (!current) return null;
  const before = previous ? lookup(previous, current.id) : undefined;
  return {
    bitrateKbps: before
      ? bitrateKbps(num(current, bytesKey), current.timestamp, num(before, bytesKey), before.timestamp)
      : null,
    framesPerSecond: num(current, 'framesPerSecond'),
    frameWidth: num(current, 'frameWidth'),
    frameHeight: num(current, 'frameHeight'),
  };
}

function inboundPacketLoss(current: StatsReportLike, previous: StatsReportLike | null): number | null {
  if (!previous) return null;
  let lostNow = 0;
  let receivedNow = 0;
  let lostBefore = 0;
  let receivedBefore = 0;
  let matched = false;
  for (const entry of entries(current).filter((e) => e.type === 'inbound-rtp')) {
    const before = lookup(previous, entry.id);
    if (!before) continue; // New stream this interval; no baseline yet.
    matched = true;
    lostNow += num(entry, 'packetsLost') ?? 0;
    receivedNow += num(entry, 'packetsReceived') ?? 0;
    lostBefore += num(before, 'packetsLost') ?? 0;
    receivedBefore += num(before, 'packetsReceived') ?? 0;
  }
  return matched ? packetLossPercent(lostNow, receivedNow, lostBefore, receivedBefore) : null;
}

/**
 * Summarise a stats report. Pass the previous report (from the same peer connection, about a
 * second earlier) to get bitrates and packet loss; without it those fields are null.
 */
export function computeCallStats(current: StatsReportLike, previous: StatsReportLike | null): CallStats {
  const pair = findSelectedCandidatePair(current);
  const local = lookup(current, str(pair, 'localCandidateId'));
  const remote = lookup(current, str(pair, 'remoteCandidateId'));
  const rttSeconds = num(pair, 'currentRoundTripTime');

  return {
    roundTripTimeMs: rttSeconds === null ? null : rttSeconds * 1000,
    packetLossPercent: inboundPacketLoss(current, previous),
    candidatePair: pair
      ? { localType: candidateType(local), remoteType: candidateType(remote), protocol: str(local, 'protocol') }
      : null,
    outboundVideo: videoStreamStats(videoRtp(current, 'outbound-rtp'), previous, 'bytesSent'),
    inboundVideo: videoStreamStats(videoRtp(current, 'inbound-rtp'), previous, 'bytesReceived'),
  };
}
