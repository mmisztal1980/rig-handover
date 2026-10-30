import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, DigestStatus, ReadNight } from './types.js';

type LogLine = {
  at: string;
  time: number; // Date.parse(at), for ordering only
  job: string;
  status: DigestStatus;
  owner: string | null;
  error?: string;
};

// Also what stops path traversal through the route param.
const NIGHT = /^\d{4}-\d{2}-\d{2}$/;

const isStatus = (value: unknown): value is DigestStatus =>
  value === 'ok' || value === 'retry' || value === 'fail';

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function parseLine(text: string): LogLine | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObject(value)) return null;

  const { at, job, status, owner, error } = value;
  if (typeof job !== 'string' || job === '') return null;
  if (!isStatus(status)) return null;
  if (typeof at !== 'string') return null;
  const time = Date.parse(at);
  if (Number.isNaN(time)) return null;
  if (owner !== undefined && owner !== null && typeof owner !== 'string') return null;
  if (error !== undefined && typeof error !== 'string') return null;

  const line: LogLine = { at, time, job, status, owner: owner ?? null };
  if (error !== undefined) line.error = error;
  return line;
}

// `lines` is ordered by time and never empty.
function toRow(job: string, lines: LogLine[]): DigestRow {
  const count = (status: DigestStatus) => lines.filter((line) => line.status === status).length;
  const first = lines[0]!;
  const last = lines[lines.length - 1]!;
  return {
    job,
    owner: last.owner,
    runs: lines.length,
    oks: count('ok'),
    retries: count('retry'),
    fails: count('fail'),
    lastStatus: last.status,
    lastError: lines.findLast((line) => line.error !== undefined)?.error ?? null,
    firstAt: first.at,
    lastAt: last.at,
  };
}

function readLog(file: string): string | null {
  try {
    return readFileSync(file, 'utf8');
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') return null;
    throw err;
  }
}

export const readNight: ReadNight = (runsDir, night) => {
  if (!NIGHT.test(night)) return null;
  const text = readLog(join(runsDir, `${night}.jsonl`));
  if (text === null) return null;

  const byJob = new Map<string, LogLine[]>();
  let badLines = 0;
  for (const raw of text.split('\n')) {
    if (raw.trim() === '') continue;
    const line = parseLine(raw);
    if (line === null) {
      badLines += 1;
      continue;
    }
    const lines = byJob.get(line.job);
    if (lines) lines.push(line);
    else byJob.set(line.job, [line]);
  }

  const rows = [...byJob]
    .map(([job, lines]) => toRow(job, lines.sort((a, b) => a.time - b.time)))
    .sort((a, b) => (a.job < b.job ? -1 : a.job > b.job ? 1 : 0));

  return { night, rows, badLines };
};
