import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

// Needs the real reader (src/digest/read.ts) to pass.
const dir = mkdtempSync(join(tmpdir(), 'rig-board-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const line = (at: string, job: string, status: string) => JSON.stringify({ at, job, status, owner: 'rook' });
writeFileSync(
  join(dir, '2026-10-27.jsonl'),
  [line('2026-10-27T23:00:00+01:00', 'a', 'ok'), line('2026-10-27T23:01:00+01:00', 'b', 'ok')].join('\n') + '\n',
);
writeFileSync(
  join(dir, '2026-10-28.jsonl'),
  [
    line('2026-10-28T23:00:00+01:00', 'a', 'retry'),
    line('2026-10-28T23:01:00+01:00', 'a', 'ok'),
    line('2026-10-28T23:02:00+01:00', 'b', 'fail'),
    line('2026-10-28T23:03:00+01:00', 'c', 'ok'),
  ].join('\n') + '\n',
);

const config = { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir: dir };

describe('board', () => {
  it('links each night to its digest with counts', async () => {
    const html = await (await createApp(config).request('/')).text();
    expect(html).toContain('<a href="/digest/2026-10-28">2026-10-28</a> · ok 2 · retry 1 · fail 1');
    expect(html).toContain('<a href="/digest/2026-10-27">2026-10-27</a> · ok 2 · retry 0 · fail 0');
  });
});
