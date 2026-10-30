import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/read.js';

const NIGHT = '2026-01-01';

describe('readNight on the real log', () => {
  const night = readNight('runs', '2026-10-28');
  const row = (job: string) => night?.rows.find((r) => r.job === job);

  it('finds 5 jobs and the cut-off last line', () => {
    expect(night?.night).toBe('2026-10-28');
    expect(night?.badLines).toBe(1);
    expect(night?.rows.map((r) => r.job)).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);
  });

  it('fixtures/refresh keeps its last error after recovering', () => {
    expect(row('fixtures/refresh')).toEqual({
      job: 'fixtures/refresh',
      owner: 'rook',
      runs: 4,
      oks: 1,
      retries: 3,
      fails: 0,
      lastStatus: 'ok',
      lastError: 'upstream 503',
      firstAt: '2026-10-29T01:30:00+01:00',
      lastAt: '2026-10-29T01:37:00+01:00',
    });
  });

  it('notes/backup failed once', () => {
    expect(row('notes/backup')).toEqual({
      job: 'notes/backup',
      owner: 'lane-07',
      runs: 1,
      oks: 0,
      retries: 0,
      fails: 1,
      lastStatus: 'fail',
      lastError: 'quota exceeded',
      firstAt: '2026-10-29T04:00:01+01:00',
      lastAt: '2026-10-29T04:00:01+01:00',
    });
  });

  it('digest/render keeps its row with a null owner', () => {
    expect(row('digest/render')).toEqual({
      job: 'digest/render',
      owner: null,
      runs: 1,
      oks: 1,
      retries: 0,
      fails: 0,
      lastStatus: 'ok',
      lastError: null,
      firstAt: '2026-10-29T05:41:09+01:00',
      lastAt: '2026-10-29T05:41:09+01:00',
    });
  });

  it('lane/sync spans midnight, offsets kept, and does not count the cut-off line', () => {
    expect(row('lane/sync')).toEqual({
      job: 'lane/sync',
      owner: 'rook',
      runs: 8,
      oks: 7,
      retries: 1,
      fails: 0,
      lastStatus: 'ok',
      lastError: 'lock held',
      firstAt: '2026-10-28T23:00:06+01:00',
      lastAt: '2026-10-29T05:00:04+01:00',
    });
  });
});

describe('readNight on temp files', () => {
  let dir: string;
  const write = (lines: string[]) => writeFileSync(join(dir, `${NIGHT}.jsonl`), lines.join('\n'));
  const log = (fields: Record<string, unknown>) =>
    JSON.stringify({ at: '2026-01-01T01:00:00+01:00', job: 'a', status: 'ok', ...fields });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rig-digest-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns null for a missing file or a missing runs dir', () => {
    expect(readNight(dir, NIGHT)).toBeNull();
    expect(readNight(join(dir, 'nope'), NIGHT)).toBeNull();
  });

  it.each(['../x', '2026-1-1', '2026-01-01\n', '2026-01-01/../../x', '', 'x2026-01-01'])(
    'returns null for the bad night string %j',
    (night) => {
      write([log({})]);
      expect(readNight(dir, night)).toBeNull();
    },
  );

  it('does not follow a traversal to a real file', () => {
    mkdirSync(join(dir, 'runs'));
    writeFileSync(join(dir, 'x.jsonl'), log({}));
    expect(readNight(join(dir, 'runs'), '../x')).toBeNull();
  });

  it('propagates read errors other than a missing file', () => {
    mkdirSync(join(dir, `${NIGHT}.jsonl`));
    expect(() => readNight(dir, NIGHT)).toThrow(/EISDIR/);
  });

  it('gives no rows and no bad lines for an empty file', () => {
    write([]);
    expect(readNight(dir, NIGHT)).toEqual({ night: NIGHT, rows: [], badLines: 0 });
  });

  it('ignores blank lines without counting them', () => {
    write(['', log({}), '   ', '\r', '']);
    const night = readNight(dir, NIGHT);
    expect(night?.badLines).toBe(0);
    expect(night?.rows[0]?.runs).toBe(1);
  });

  it('orders lines by instant, not by file position or string', () => {
    // By string, `late` would sort before `middle`.
    const early = '2026-01-01T00:30:00+02:00'; // 22:30Z
    const middle = '2026-01-01T01:00:00+02:00'; // 23:00Z
    const late = '2026-01-01T00:30:00+01:00'; // 23:30Z
    write([
      log({ at: late, status: 'ok', owner: 'latest' }),
      log({ at: early, status: 'fail', owner: 'earliest', error: 'first' }),
      log({ at: middle, status: 'retry', owner: 'middle', error: 'second' }),
    ]);
    expect(readNight(dir, NIGHT)?.rows[0]).toEqual({
      job: 'a',
      owner: 'latest',
      runs: 3,
      oks: 1,
      retries: 1,
      fails: 1,
      lastStatus: 'ok',
      lastError: 'second',
      firstAt: early,
      lastAt: late,
    });
  });

  it('keeps file order for lines at the same instant', () => {
    write([
      log({ status: 'fail', owner: 'one', error: 'one' }),
      log({ status: 'retry', owner: 'two', error: 'two' }),
      log({ status: 'ok', owner: 'three' }),
    ]);
    const row = readNight(dir, NIGHT)?.rows[0];
    expect(row?.lastStatus).toBe('ok');
    expect(row?.owner).toBe('three');
    expect(row?.lastError).toBe('two');
  });

  it('takes the owner from the latest line, even when that is null or missing', () => {
    write([
      log({ job: 'nulled', at: '2026-01-01T01:00:00+01:00', owner: 'early' }),
      log({ job: 'nulled', at: '2026-01-01T02:00:00+01:00', owner: null }),
      log({ job: 'absent', at: '2026-01-01T01:00:00+01:00', owner: 'early' }),
      log({ job: 'absent', at: '2026-01-01T02:00:00+01:00' }),
      log({ job: 'named', at: '2026-01-01T02:00:00+01:00', owner: 'late' }),
      log({ job: 'named', at: '2026-01-01T01:00:00+01:00', owner: null }),
    ]);
    const night = readNight(dir, NIGHT);
    expect(night?.badLines).toBe(0);
    expect(night?.rows.map((r) => [r.job, r.owner])).toEqual([
      ['absent', null],
      ['named', 'late'],
      ['nulled', null],
    ]);
  });

  it('sorts rows by code unit, not locale', () => {
    write(['b', 'a', 'Z', 'é', 'A'].map((job) => log({ job })));
    expect(readNight(dir, NIGHT)?.rows.map((r) => r.job)).toEqual(['A', 'Z', 'a', 'b', 'é']);
  });

  it('keeps __proto__ as an ordinary job name', () => {
    write([log({ job: '__proto__' }), log({ job: 'constructor' })]);
    expect(readNight(dir, NIGHT)?.rows.map((r) => r.job)).toEqual(['__proto__', 'constructor']);
  });

  it.each([
    ['not JSON', '{"at":'],
    ['a number', '1'],
    ['a string', '"line"'],
    ['null', 'null'],
    ['an array', '[]'],
    ['an array holding a good line', `[${log({})}]`],
    ['job missing', JSON.stringify({ at: '2026-01-01T01:00:00+01:00', status: 'ok' })],
    ['job empty', log({ job: '' })],
    ['job not a string', log({ job: 7 })],
    ['status missing', JSON.stringify({ at: '2026-01-01T01:00:00+01:00', job: 'a' })],
    ['status unknown', log({ status: 'OK' })],
    ['status not a string', log({ status: 1 })],
    ['at missing', JSON.stringify({ job: 'a', status: 'ok' })],
    ['at not a string', log({ at: 1767225600000 })],
    ['at not a date', log({ at: 'last night' })],
    ['owner a number', log({ owner: 7 })],
    ['owner an object', log({ owner: {} })],
    ['error null', log({ error: null })],
    ['error a number', log({ error: 503 })],
  ])('counts a bad line and drops it: %s', (_name, line) => {
    write([log({ job: 'good' }), line]);
    const night = readNight(dir, NIGHT);
    expect(night?.badLines).toBe(1);
    expect(night?.rows.map((r) => [r.job, r.runs])).toEqual([['good', 1]]);
  });
});
