import type { DigestNight } from './types.js';

export type NightCounts = { ok: number; retry: number; fail: number };

export function countNight(night: DigestNight): NightCounts {
  const counts: NightCounts = { ok: 0, retry: 0, fail: 0 };
  for (const r of night.rows) {
    counts.ok += r.oks;
    counts.retry += r.retries;
    counts.fail += r.fails;
  }
  return counts;
}
