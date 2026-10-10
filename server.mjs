import http from 'node:http';
import { readFile, open, mkdir, link, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { AppError, createStore, validId, text } from './store.mjs';
import { createModelBridge } from './model-bridge.mjs';

export const APP_ROOT = fileURLToPath(new URL('.', import.meta.url));
export const DATA_DIRECTORY = join(APP_ROOT, 'data');
const BODY_LIMIT = 96 * 1024;
function sameSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const aa = Buffer.from(a), bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
export async function loadAgentKey(directory) {
  await mkdir(directory, { recursive: true });
  const path = join(directory, '.agent-key');
  const pending = `${path}.${randomBytes(12).toString('hex')}.pending`;
  try {
    const handle = await open(pending, 'wx', 0o600);
    try { await handle.writeFile(randomBytes(32).toString('hex')); await handle.sync(); }
    finally { await handle.close(); }
    try { await link(pending, path); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  } finally { await unlink(pending).catch(() => {}); }
  const key = await readFile(path, 'utf8');
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Local agent key is invalid; refusing to start.');
  return key;
}
async function readBody(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) throw new AppError(415, 'Use application/json.');
  const parts = []; let size = 0;
  for await (const part of req) {
    size += part.length;
    if (size > BODY_LIMIT) throw new AppError(413, 'Request body is too large.');
    parts.push(part);
  }
  try { return JSON.parse(Buffer.concat(parts).toString('utf8')); }
  catch { throw new AppError(400, 'Invalid JSON body.'); }
}
export async function createApplication({ directory = DATA_DIRECTORY, agentKey, modelInvoke, cliPath, nodePath } = {}) {
  const store = createStore(directory); await store.init();
  const modelBridge = createModelBridge({ store, directory, invoke: modelInvoke, cliPath, nodePath });
  agentKey ??= await loadAgentKey(directory);
  const browserToken = randomBytes(32).toString('hex');
  const receiptSecret = randomBytes(32);
  function issueReceipt(id, answerRevision) {
    const payload = Buffer.from(JSON.stringify({ id, answerRevision, expires: Date.now() + 30 * 60 * 1000 })).toString('base64url');
    return `${payload}.${createHmac('sha256', receiptSecret).update(payload).digest('hex')}`;
  }
  function verifyReceipt(receipt, id) {
    if (typeof receipt !== 'string' || receipt.length > 500) throw new AppError(403, 'Read the request through the adapter first.');
    const [payload, signature, extra] = receipt.split('.');
    if (extra || !payload || !sameSecret(signature, createHmac('sha256', receiptSecret).update(payload).digest('hex'))) throw new AppError(403, 'Invalid read receipt. Read the request again.');
    let data;
    try { data = JSON.parse(Buffer.from(payload, 'base64url').toString()); }
    catch { throw new AppError(403, 'Invalid read receipt.'); }
    if (data.id !== id || data.expires < Date.now()) throw new AppError(403, 'Read receipt expired or belongs to another request. Read again.');
    return data;
  }
  const assets = {
    '/': ['index.html', 'text/html; charset=utf-8'],
    '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
    '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  };
  const server = http.createServer(async (req, res) => {
    const headers = {
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    };
    function json(status, value) {
      res.writeHead(status, { ...headers, 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(value));
    }
    try {
      const host = `127.0.0.1:${server.address().port}`;
      if (req.headers.host !== host) throw new AppError(403, `Open the app at http://${host}.`);
      const origin = req.headers.origin;
      if (origin && origin !== `http://${host}`) throw new AppError(403, 'Cross-origin requests are not allowed.');
      const site = req.headers['sec-fetch-site'];
      if (site && !['same-origin', 'none'].includes(site)) throw new AppError(403, 'Cross-site requests are not allowed.');
      const url = new URL(req.url, `http://${host}`);
      const path = url.pathname;
      if (req.method === 'GET' && path === '/favicon.ico') { res.writeHead(204, headers); res.end(); return; }
      if (req.method === 'GET' && (assets[path] || /^\/requests\/[^/]+$/.test(path))) {
        if (path.startsWith('/requests/')) validId(path.slice('/requests/'.length));
        const [name, type] = assets[path] ?? assets['/'];
        const bytes = await readFile(join(APP_ROOT, 'public', name));
        res.writeHead(200, { ...headers, 'Content-Type': type }); res.end(bytes); return;
      }
      if (req.method === 'GET' && path === '/api/session') {
        json(200, { token: browserToken }); return;
      }
      if (req.method === 'GET' && path === '/api/model/status') {
        json(200, modelBridge.status(validId(url.searchParams.get('id')))); return;
      }
      if (req.method === 'POST' && ['/api/model/connect', '/api/model/disconnect', '/api/model/start'].includes(path)) {
        if (!sameSecret(req.headers['x-browser-token'], browserToken)) throw new AppError(403, 'Browser session required. Reload before connecting or starting AI.');
        const body = await readBody(req);
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AppError(400, 'Expected a JSON object.');
        const allowed = path === '/api/model/connect' ? ['key'] : path === '/api/model/start' ? ['id'] : [];
        if (Object.keys(body).some((field) => !allowed.includes(field)) || allowed.some((field) => !(field in body))) throw new AppError(400, 'Unexpected connection field.');
        if (path === '/api/model/connect') json(200, modelBridge.connect(body.key));
        else if (path === '/api/model/disconnect') json(200, modelBridge.disconnect());
        else json(202, await modelBridge.start(body.id));
        return;
      }
      if (req.method === 'POST' && path === '/api/requests') {
        if (!sameSecret(req.headers['x-browser-token'], browserToken)) throw new AppError(403, 'Session expired. Reload and try again.');
        json(201, await store.create(await readBody(req))); return;
      }
      const mutation = path.match(/^\/api\/requests\/([^/]+)\/(answers|package-edit|package-review)$/);
      if (req.method === 'POST' && mutation) {
        if (!sameSecret(req.headers['x-browser-token'], browserToken)) throw new AppError(403, 'Browser session required. Reload before saving.');
        const id = validId(mutation[1]); const body = await readBody(req);
        json(200, mutation[2] === 'answers' ? await store.saveAnswers(id, body) : await store.updatePackage(id, body, mutation[2] === 'package-review')); return;
      }
      if (req.method === 'GET' && path.startsWith('/api/requests/')) {
        json(200, await store.get(path.slice('/api/requests/'.length))); return;
      }
      if (req.method === 'POST' && ['/agent/read', '/agent/ack', '/agent/plan', '/agent/preparation', '/agent/continuation'].includes(path)) {
        if (!sameSecret(req.headers['x-agent-key'], agentKey)) throw new AppError(403, 'Local adapter authorisation required.');
        const body = await readBody(req);
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AppError(400, 'Expected a JSON object.');
        const allowed = path === '/agent/read' ? ['id'] : path === '/agent/ack' ? ['id', 'readReceipt', 'summary'] : ['id', 'readReceipt', 'content'];
        if (Object.keys(body).some((key) => !allowed.includes(key))) throw new AppError(400, 'Unexpected adapter field.');
        const id = validId(body.id);
        if (path === '/agent/read') {
          const request = await store.get(id);
          json(200, { ...request, readReceipt: issueReceipt(id, request.answerRevision) }); return;
        }
        const receiptData = verifyReceipt(body.readReceipt, id);
        if (path === '/agent/continuation') { json(200, await store.continueTask(id, body.content, receiptData.answerRevision)); return; }
        if (path === '/agent/ack') json(200, await store.acknowledge(id, text(body.summary, 'Acknowledgement summary', 1000)));
        else json(200, await store.saveWorkflow(id, path.slice('/agent/'.length), body.content));
        return;
      }
      throw new AppError(404, 'Route not found.');
    } catch (error) {
      const status = error instanceof AppError ? error.status : 500;
      if (!res.headersSent) json(status, { error: status === 500 ? 'Local storage or server error. No success was recorded. Check the server terminal.' : error.message });
      if (status === 500) console.error(error);
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  return { server, store };
}
export async function startApplication(options = {}) {
  const port = options.port ?? Number(process.env.SPONSORBRIDGE_PORT ?? 4317);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid port.');
  const app = await createApplication(options);
  await new Promise((yes, no) => { app.server.once('error', no); app.server.listen(port, '127.0.0.1', yes); });
  return app;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const app = await startApplication();
    console.log(`SponsorBridge local prototype: http://127.0.0.1:${app.server.address().port}`);
    console.log(`Local data: ${DATA_DIRECTORY}`);
    console.log('Saving never launches WorkBuddy. Start it manually with the request instruction.');
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
      app.server.close(() => process.exit(0)); app.server.closeIdleConnections();
    });
  } catch (error) { console.error(`Cannot start SponsorBridge: ${error.message}`); process.exitCode = 1; }
}
