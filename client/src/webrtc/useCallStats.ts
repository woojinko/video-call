import { useEffect, useState } from 'react';
import { computeCallStats, type CallStats, type StatsReportLike } from './stats';

const POLL_INTERVAL_MS = 1000;

/**
 * Polls getStats() once a second while `enabled`, and summarises each report against the previous
 * one. Returns null while disabled or when there is no peer connection.
 */
export function useCallStats(getStats: () => Promise<StatsReportLike | null>, enabled: boolean): CallStats | null {
  const [stats, setStats] = useState<CallStats | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let previous: StatsReportLike | null = null;

    const poll = async () => {
      let report: StatsReportLike | null = null;
      try {
        report = await getStats();
      } catch (err) {
        console.debug('[webrtc] getStats failed:', err);
      }
      if (cancelled) return;
      setStats(report ? computeCallStats(report, previous) : null);
      // Dropping the baseline when the connection goes away means the next connection's first
      // sample isn't compared with the old one's counters.
      previous = report;
    };

    void poll();
    const timer = setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
      setStats(null);
    };
  }, [getStats, enabled]);

  return enabled ? stats : null;
}
