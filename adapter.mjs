import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validId, text } from './store.mjs';
import { DATA_DIRECTORY } from './server.mjs';

export async function runAdapter(args, { baseUrl = 'http://127.0.0.1:4317', keyFile = `${DATA_DIRECTORY}/.agent-key` } = {}) {
  const [command, id, receipt, payload] = args;
  validId(id);
  if (!['read', 'ack', 'plan', 'preparation', 'continuation'].includes(command) || (command === 'read' && args.length !== 2) || (command !== 'read' && args.length !== 4)) {
    throw new Error('Usage: adapter.mjs read REQUEST_ID | ack REQUEST_ID READ_RECEIPT "SUMMARY" | plan/preparation/continuation REQUEST_ID READ_RECEIPT "CONTENT_JSON"');
  }
  const base = new URL(baseUrl);
  if (base.protocol !== 'http:' || base.hostname !== '127.0.0.1') throw new Error('Adapter only connects to IPv4 loopback.');
  const key = await readFile(keyFile, 'utf8').catch(() => { throw new Error('Start the local server first. Local adapter key is missing.'); });
  let body = { id };
  if (command === 'ack') body = { id, readReceipt: receipt, summary: text(payload, 'Goal summary', 1000) };
  if (['plan', 'preparation', 'continuation'].includes(command)) {
    let content;
    try { content = JSON.parse(payload); } catch { throw new Error('Workflow content must be valid JSON.'); }
    body = { id, readReceipt: receipt, content };
  }
  let response;
  try {
    response = await fetch(new URL(`/agent/${command}`, base), {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Agent-Key': key },
      body: JSON.stringify(body), signal: AbortSignal.timeout(10000), redirect: 'error',
    });
  } catch { throw new Error('Cannot reach PUTRApitch. Start the server at http://127.0.0.1:4317.'); }
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? `Adapter request failed (${response.status}).`);
  return result;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await runAdapter(process.argv.slice(2)), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
