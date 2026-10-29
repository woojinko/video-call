import { describe, expect, it } from 'vitest';
import { bitrateKbps, computeCallStats, findSelectedCandidatePair, packetLossPercent } from './stats';

type Entry = { id: string; type: string; timestamp: number; [key: string]: unknown };

function report(...list: Entry[]): Map<string, unknown> {
  return new Map(list.map((e) => [e.id, e]));
}

// A Chrome-shaped report: transport → selected pair → local/remote candidates, plus RTP streams.
function chromeReport(t: number, counters: { sent: number; received: number; lost: number; packets: number }) {
  return report(
    { id: 'T01', type: 'transport', timestamp: t, selectedCandidatePairId: 'CP1' },
    {
      id: 'CP1',
      type: 'candidate-pair',
      timestamp: t,
      localCandidateId: 'L1',
      remoteCandidateId: 'R1',
      currentRoundTripTime: 0.042,
      nominated: true,
      state: 'succeeded',
    },
    { id: 'CP2', type: 'candidate-pair', timestamp: t, localCandidateId: 'L2', remoteCandidateId: 'R1' },
    { id: 'L1', type: 'local-candidate', timestamp: t, candidateType: 'relay', protocol: 'udp' },
    { id: 'L2', type: 'local-candidate', timestamp: t, candidateType: 'host', protocol: 'udp' },
    { id: 'R1', type: 'remote-candidate', timestamp: t, candidateType: 'srflx', protocol: 'udp' },
    {
      id: 'OV',
      type: 'outbound-rtp',
      kind: 'video',
      timestamp: t,
      bytesSent: counters.sent,
      framesPerSecond: 30,
      frameWidth: 1280,
      frameHeight: 720,
    },
    {
      id: 'IV',
      type: 'inbound-rtp',
      kind: 'video',
      timestamp: t,
      bytesReceived: counters.received,
      packetsLost: counters.lost,
      packetsReceived: counters.packets,
      framesPerSecond: 24,
      frameWidth: 640,
      frameHeight: 360,
    },
    { id: 'IA', type: 'inbound-rtp', kind: 'audio', timestamp: t, packetsLost: 0, packetsReceived: 0 },
  );
}

describe('bitrateKbps', () => {
  it('converts a byte delta over milliseconds to kilobits per second', () => {
    expect(bitrateKbps(125_000, 2000, 0, 1000)).toBe(1000);
  });

  it('is null when the counter went backwards, time did not advance, or a reading is missing', () => {
    expect(bitrateKbps(10, 2000, 500, 1000)).toBeNull();
    expect(bitrateKbps(500, 1000, 10, 1000)).toBeNull();
    expect(bitrateKbps(null, 2000, 10, 1000)).toBeNull();
  });
});

describe('packetLossPercent', () => {
  it('is lost / (lost + received) over the interval', () => {
    expect(packetLossPercent(15, 190, 10, 100)).toBeCloseTo((5 / 95) * 100);
  });

  it('never goes negative when duplicates lower packetsLost', () => {
    expect(packetLossPercent(8, 200, 10, 100)).toBe(0);
  });

  it('is null when no packets were expected or the counters reset', () => {
    expect(packetLossPercent(10, 100, 10, 100)).toBeNull();
    expect(packetLossPercent(0, 5, 10, 100)).toBeNull();
  });
});

describe('findSelectedCandidatePair', () => {
  it('follows transport.selectedCandidatePairId (Chrome, Safari)', () => {
    expect(findSelectedCandidatePair(chromeReport(0, { sent: 0, received: 0, lost: 0, packets: 0 }))?.id).toBe('CP1');
  });

  it('falls back to the pair marked selected (Firefox)', () => {
    const r = report(
      { id: 'a', type: 'candidate-pair', timestamp: 0, nominated: true, state: 'succeeded' },
      { id: 'b', type: 'candidate-pair', timestamp: 0, selected: true },
    );
    expect(findSelectedCandidatePair(r)?.id).toBe('b');
  });

  it('then to a nominated, succeeded pair, and otherwise finds nothing', () => {
    const r = report(
      { id: 'a', type: 'candidate-pair', timestamp: 0, state: 'in-progress' },
      { id: 'b', type: 'candidate-pair', timestamp: 0, nominated: true, state: 'succeeded' },
    );
    expect(findSelectedCandidatePair(r)?.id).toBe('b');
    expect(findSelectedCandidatePair(report())).toBeUndefined();
  });
});

describe('computeCallStats', () => {
  const before = chromeReport(1000, { sent: 0, received: 0, lost: 0, packets: 0 });
  const now = chromeReport(2000, { sent: 250_000, received: 62_500, lost: 1, packets: 99 });

  it('reads RTT, the selected pair, and video frame stats', () => {
    const stats = computeCallStats(now, before);
    expect(stats.roundTripTimeMs).toBeCloseTo(42);
    expect(stats.candidatePair).toEqual({ localType: 'relay', remoteType: 'srflx', protocol: 'udp' });
    expect(stats.outboundVideo).toEqual({ bitrateKbps: 2000, framesPerSecond: 30, frameWidth: 1280, frameHeight: 720 });
    expect(stats.inboundVideo).toEqual({ bitrateKbps: 500, framesPerSecond: 24, frameWidth: 640, frameHeight: 360 });
    expect(stats.packetLossPercent).toBeCloseTo(1);
  });

  it('leaves rates null on the first sample', () => {
    const stats = computeCallStats(now, null);
    expect(stats.outboundVideo?.bitrateKbps).toBeNull();
    expect(stats.inboundVideo?.bitrateKbps).toBeNull();
    expect(stats.packetLossPercent).toBeNull();
    expect(stats.roundTripTimeMs).toBeCloseTo(42);
  });

  it('leaves rates null when the previous report came from an older connection', () => {
    const stats = computeCallStats(before, now); // counters went backwards
    expect(stats.outboundVideo?.bitrateKbps).toBeNull();
    expect(stats.inboundVideo?.bitrateKbps).toBeNull();
    expect(stats.packetLossPercent).toBeNull();
  });

  it('copes with an empty report and ignores malformed entries', () => {
    const r = new Map<string, unknown>([
      ['x', null],
      ['y', { type: 'candidate-pair' }],
    ]);
    expect(computeCallStats(r, null)).toEqual({
      roundTripTimeMs: null,
      packetLossPercent: null,
      candidatePair: null,
      outboundVideo: null,
      inboundVideo: null,
    });
  });
});
