import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const line = (at: string, job: string, status: string, owner: string | null, error?: string) =>
  JSON.stringify({ at, job, status, owner, ...(error ? { error } : {}) });

let runsDir: string;
let app: ReturnType<typeof createApp>;

const night = (name: string, lines: string[]) =>
  writeFileSync(join(runsDir, `${name}.jsonl`), lines.length ? `${lines.join('\n')}\n` : '');

beforeAll(() => {
  runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-'));
  mkdirSync(runsDir, { recursive: true });
  // jobs deliberately out of alphabetical order in the file
  night('2026-10-28', [
    line('2026-10-28T23:00:02+01:00', 'zeta/last', 'ok', 'rook'),
    line('2026-10-28T23:01:00+01:00', 'alpha/first', 'ok', null),
    line('2026-10-28T23:02:00+01:00', 'mid/job', 'fail', 'rook', 'boom'),
    line('2026-10-28T23:03:00+01:00', 'beta/retried', 'retry', 'rook'),
    line('2026-10-28T23:04:00+01:00', 'beta/retried', 'retry', 'rook'),
    line('2026-10-28T23:05:00+01:00', 'beta/retried', 'retry', 'rook'),
  ]);
  night('2026-10-27', []);
  night('2026-10-26', [
    line('2026-10-26T23:00:02+01:00', 'a/b', 'ok', 'rook'),
    'this is not json',
    line('2026-10-26T23:10:00+01:00', 'c/d', 'ok', 'rook'),
  ]);
  night('2026-10-25', [line('2026-10-25T23:00:00+01:00', 'clean/job', 'ok', 'rook')]);
  app = createApp({
    adapter: 'shim',
    installed: '2026-10-29T14:06:00+01:00',
    beatEverySeconds: 60,
    runsDir,
  });
});

afterAll(() => rmSync(runsDir, { recursive: true, force: true }));

type Row = { job: string; owner: string | null; [k: string]: unknown };
type Body = { night: string; rows: Row[]; badLines: number };

describe('GET /digest/:night', () => {
  it('renders the rows in one table', async () => {
    const res = await app.request('/digest/2026-10-28');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html.match(/<table/g)).toHaveLength(1);
    for (const job of ['alpha/first', 'beta/retried', 'mid/job', 'zeta/last']) expect(html).toContain(job);
    expect(html).not.toContain('could not be read');
  });

  it('renders a missing owner as a dash', async () => {
    const html = await (await app.request('/digest/2026-10-28')).text();
    expect(html).toContain('—');
  });

  it('marks rows with 3+ retries or any fail as warn', async () => {
    const warn = await (await app.request('/digest/2026-10-28')).text();
    expect(warn.match(/class="warn"/g)?.length).toBe(2);
    const clean = await (await app.request('/digest/2026-10-25')).text();
    expect(clean).not.toContain('class="warn"');
  });

  it('404s when the night has no file', async () => {
    expect((await app.request('/digest/2026-01-01')).status).toBe(404);
  });

  it('404s on a malformed night', async () => {
    expect((await app.request('/digest/not-a-night')).status).toBe(404);
    expect((await app.request('/digest/..%2F..%2Fetc%2Fpasswd')).status).toBe(404);
  });

  it('says nothing ran for an empty file', async () => {
    const res = await app.request('/digest/2026-10-27');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('nothing ran');
  });

  it('reports a bad line and still renders the valid rows', async () => {
    const res = await app.request('/digest/2026-10-26');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('1 line could not be read');
    expect(html).toContain('a/b');
    expect(html).toContain('c/d');
  });
});

describe('GET /api/digest/:night', () => {
  it('returns night, rows and badLines', async () => {
    const res = await app.request('/api/digest/2026-10-28');
    const body = (await res.json()) as Body;
    expect(res.status).toBe(200);
    expect(body.night).toBe('2026-10-28');
    expect(body.badLines).toBe(0);
    expect(body.rows).toHaveLength(4);
    for (const row of body.rows) {
      expect(Object.keys(row).sort()).toEqual(
        ['job', 'owner', 'runs', 'oks', 'retries', 'fails', 'lastStatus', 'lastError', 'firstAt', 'lastAt'].sort(),
      );
    }
    const alpha = body.rows.find((r) => r.job === 'alpha/first');
    expect(alpha?.owner).toBeNull();
    const beta = body.rows.find((r) => r.job === 'beta/retried');
    expect(beta).toMatchObject({ runs: 3, retries: 3, lastStatus: 'retry', firstAt: '2026-10-28T23:03:00+01:00' });
    const mid = body.rows.find((r) => r.job === 'mid/job');
    expect(mid).toMatchObject({ fails: 1, lastStatus: 'fail', lastError: 'boom' });
  });

  it('404s when the night has no file', async () => {
    expect((await app.request('/api/digest/2026-01-01')).status).toBe(404);
  });

  it('404s on a malformed night', async () => {
    expect((await app.request('/api/digest/not-a-night')).status).toBe(404);
    expect((await app.request('/api/digest/..%2F..%2Fetc%2Fpasswd')).status).toBe(404);
  });

  it('gives no rows and no bad lines for an empty file', async () => {
    const res = await app.request('/api/digest/2026-10-27');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ night: '2026-10-27', rows: [], badLines: 0 });
  });

  it('counts a bad line and keeps the valid rows', async () => {
    const body = (await (await app.request('/api/digest/2026-10-26')).json()) as Body;
    expect(body.badLines).toBe(1);
    expect(body.rows.map((r) => r.job)).toEqual(['a/b', 'c/d']);
  });
});

describe('page and JSON agree', () => {
  it('lists jobs in the same order', async () => {
    const body = (await (await app.request('/api/digest/2026-10-28')).json()) as Body;
    const html = await (await app.request('/digest/2026-10-28')).text();
    const jobs = body.rows.map((r) => r.job);
    expect(jobs).not.toEqual(['zeta/last', 'alpha/first', 'mid/job', 'beta/retried']);
    const positions = jobs.map((j) => html.indexOf(j));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });
});
