// Plan morning-digest § 1. The contract section 2 codes against; the reader comes later.
export type DigestStatus = 'ok' | 'retry' | 'fail';

// Times are the log's own strings with their offset, never converted.
export type DigestRow = {
  job: string;
  owner: string | null;
  runs: number; // log lines for the job
  oks: number;
  retries: number;
  fails: number;
  lastStatus: DigestStatus;
  lastError: string | null; // most recent error seen for the job, even if its last status is ok
  firstAt: string;
  lastAt: string;
};

export type DigestNight = {
  night: string;
  rows: DigestRow[]; // sorted by job, plain code-unit comparison: page and JSON share one order
  badLines: number;
};

// null means no such night: no file, or `night` is not YYYY-MM-DD.
export type ReadNight = (runsDir: string, night: string) => DigestNight | null;
