import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { APP_ROOT, startApplication } from '../server.mjs';
import { extractProposalText } from '../pdf-import.mjs';

export function pdfWithText(text) {
  const stream = `BT /F1 14 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(body);
}

test('PDF import extracts selectable proposal text and rejects image-only or invalid content', async () => {
  const result = await extractProposalText(pdfWithText('Campus Sustainability Fair'));
  assert.equal(result.text, 'Campus Sustainability Fair');
  assert.equal(result.pages, 1);
  await assert.rejects(extractProposalText(pdfWithText('')), (error) => error.status === 422 && /No selectable text/.test(error.message));
  await assert.rejects(extractProposalText(Buffer.from('not a PDF document')), (error) => error.status === 400);
});

test('PDF import endpoint requires browser session and does not store the original PDF', async (t) => {
  const parent = join(APP_ROOT, 'test', '.temporary');
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, 'pdf-import-'));
  const app = await startApplication({ directory, port: 0 });
  t.after(() => new Promise((resolve) => { app.server.close(resolve); app.server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const body = pdfWithText('Swimming Clinic Proposal');
  const upload = (headers) => fetch(`${base}/api/proposals/extract-pdf`, { method: 'POST', headers, body });
  assert.equal((await upload({ 'Content-Type': 'application/pdf' })).status, 403);
  const token = (await (await fetch(`${base}/api/session`)).json()).token;
  const response = await upload({ 'Content-Type': 'application/pdf', 'X-Browser-Token': token });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).text, 'Swimming Clinic Proposal');
  assert.equal((await upload({ 'Content-Type': 'text/plain', 'X-Browser-Token': token })).status, 415);
  assert.equal((await readdir(directory)).filter((name) => name.endsWith('.pdf')).length, 0);
});
