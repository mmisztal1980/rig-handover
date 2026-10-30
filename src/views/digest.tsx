import type { DigestNight, DigestRow } from '../digest/types.js';

const dash = '—';

function flag(row: DigestRow): string {
  const parts: string[] = [];
  if (row.retries >= 3) parts.push('retries');
  if (row.fails > 0) parts.push('fail');
  return parts.length > 0 ? parts.join(' ') : dash;
}

export function DigestPage({ digest }: { digest: DigestNight }) {
  const n = digest.badLines;
  return (
    <>
      <h1>{digest.night}</h1>
      {n > 0 ? <p class="warn">{n === 1 ? '1 line could not be read' : `${n} lines could not be read`}</p> : null}
      {digest.rows.length === 0 ? (
        <p class="mute">nothing ran</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>job</th><th>owner</th><th>runs</th><th>retries</th><th>fails</th>
              <th>last status</th><th>last error</th><th>first</th><th>last</th><th>flag</th>
            </tr>
          </thead>
          <tbody>
            {digest.rows.map((r) => {
              const f = flag(r);
              return (
                <tr class={f === dash ? undefined : 'warn'}>
                  <td>{r.job}</td>
                  <td>{r.owner ?? dash}</td>
                  <td>{r.runs}</td>
                  <td>{r.retries}</td>
                  <td>{r.fails}</td>
                  <td>{r.lastStatus}</td>
                  <td>{r.lastError ?? dash}</td>
                  <td>{r.firstAt}</td>
                  <td>{r.lastAt}</td>
                  <td>{f}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}

export function DigestMissing({ night }: { night: string }) {
  return (
    <>
      <h1>no digest</h1>
      <p class="mute">no run log for {night}</p>
    </>
  );
}
