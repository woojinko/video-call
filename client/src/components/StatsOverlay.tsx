import type { CallStats, VideoStreamStats } from '../webrtc/stats';

const DASH = '–';

function fmt(value: number | null | undefined, unit: string, digits = 0): string {
  return value === null || value === undefined ? DASH : `${value.toFixed(digits)} ${unit}`;
}

function video(stream: VideoStreamStats | null): string {
  if (!stream) return DASH;
  const resolution =
    stream.frameWidth !== null && stream.frameHeight !== null ? `${stream.frameWidth}×${stream.frameHeight}` : DASH;
  return `${fmt(stream.bitrateKbps, 'kbps')} · ${resolution} · ${fmt(stream.framesPerSecond, 'fps')}`;
}

function route(pair: CallStats['candidatePair']): string {
  if (!pair) return DASH;
  const protocol = pair.protocol ? ` (${pair.protocol})` : '';
  return `${pair.localType ?? '?'} → ${pair.remoteType ?? '?'}${protocol}`;
}

export function StatsOverlay({ stats }: { stats: CallStats | null }) {
  return (
    <aside className="stats-overlay" aria-label="Connection stats">
      {!stats ? (
        <p>No active connection</p>
      ) : (
        <dl>
          <dt>Route</dt>
          <dd data-stat="route">{route(stats.candidatePair)}</dd>
          <dt>RTT</dt>
          <dd data-stat="rtt">{fmt(stats.roundTripTimeMs, 'ms')}</dd>
          <dt>Loss (in)</dt>
          <dd data-stat="loss">{fmt(stats.packetLossPercent, '%', 1)}</dd>
          <dt>Video out</dt>
          <dd data-stat="video-out">{video(stats.outboundVideo)}</dd>
          <dt>Video in</dt>
          <dd data-stat="video-in">{video(stats.inboundVideo)}</dd>
        </dl>
      )}
    </aside>
  );
}
