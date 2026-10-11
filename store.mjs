import { mkdir, open, readFile, link, unlink, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { validatePlan, validateResult } from './workflow.mjs';
import { validateAnswers, validateContinuation, validatePackage, revision } from './packages.mjs';

export const ID_PATTERN = /^req_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export class AppError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function validId(id) {
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) throw new AppError(400, 'Invalid request ID.');
  return id;
}
export function text(value, field, max) {
  if (typeof value !== 'string' || !value.trim()) throw new AppError(400, `${field} must not be blank.`);
  if (value.length > max) throw new AppError(400, `${field} must be ${max} characters or fewer.`);
  if (/\u0000/.test(value)) throw new AppError(400, `${field} contains an invalid character.`);
  return value; // Validate with trim, but preserve the submitted text exactly.
}

// Immutable files: publish only a fully written, flushed file. A hard link is
// atomic and fails if the destination exists, rather than replacing user data.
export async function publishOnce(file, value) {
  const temporary = `${file}.${randomUUID()}.pending`;
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await handle.sync();
    await handle.close(); handle = undefined;
    await link(temporary, file);
  } finally {
    if (handle) await handle.close();
    await unlink(temporary).catch(() => console.warn('An unpublished temporary file remains; committed data is unaffected.'));
  }
}

// Single local server is the mutation owner. Cross-store locks in this process
// serialise answer/continuation/review checks; immutable revision files reject
// competing publications. Running two new mutation servers is unsupported.
const activeMutations = new Set();
const WORKFLOW_ACTORS = ['WorkBuddy via local adapter', 'CodeBuddy CLI via API key'];
const cardHash = (content) => createHash('sha256').update(JSON.stringify(content)).digest('hex');
export function createStore(directory) {
  const file = (id, suffix) => join(directory, `${validId(id)}.${suffix}.json`);
  async function load(path, optional = false) {
    try {
      const parsed = JSON.parse(await readFile(path, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid stored object.');
      return parsed;
    }
    catch (error) {
      if (error.code === 'ENOENT') {
        if (optional) return null;
        throw new AppError(404, 'Request not found.');
      }
      throw new AppError(500, 'Stored data could not be read. It has not been overwritten.');
    }
  }
  async function history(id, kind) {
    const prefix = `${validId(id)}.${kind}.`;
    const names = (await readdir(directory)).filter((n) => n.startsWith(prefix) && /^\d+\.json$/.test(n.slice(prefix.length)));
    const records = await Promise.all(names.map((n) => load(join(directory, n))));
    records.sort((a, b) => a.revision - b.revision);
    if (records.some((r, i) => r.revision !== i + 1 || r.requestId !== id)) throw new AppError(500, 'Revision history is invalid; no records overwritten.');
    return records;
  }
  async function append(id, kind, expected, record) {
    try { await publishOnce(file(id, `${kind}.${expected + 1}`), { ...record, requestId: id, revision: expected + 1, recordedAt: new Date().toISOString() }); }
    catch (error) { if (error.code === 'EEXIST') throw new AppError(409, 'Stale revision. Reload saved state; your edit was not applied.'); throw error; }
  }
  async function locked(id, operation) {
    const key = join(directory, validId(id));
    if (activeMutations.has(key)) throw new AppError(409, 'Another update is in progress. Reload and retry; no update applied.');
    activeMutations.add(key);
    try { return await operation(); }
    finally { activeMutations.delete(key); }
  }
  return {
    async init() { await mkdir(directory, { recursive: true }); },
    async create(input) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AppError(400, 'Expected a JSON object.');
      if (Object.keys(input).some((key) => !['proposal', 'goal'].includes(key))) throw new AppError(400, 'Only proposal and goal are accepted.');
      const proposal = text(input.proposal, 'Proposal', 20000);
      const goal = text(input.goal, 'Sponsorship goal', 2000);
      const record = { schemaVersion: 1, id: `req_${randomUUID()}`, proposal, goal, createdAt: new Date().toISOString() };
      await publishOnce(file(record.id, 'request'), record);
      return this.get(record.id);
    },
    async get(id, snapshotAttempt = 0) {
      const record = await load(file(id, 'request'));
      const acknowledgement = await load(file(id, 'ack'), true);
      if (record.id !== id || record.schemaVersion !== 1 || typeof record.proposal !== 'string' || typeof record.goal !== 'string') {
        throw new AppError(500, 'Stored request is invalid. It has not been overwritten.');
      }
      if (acknowledgement && (acknowledgement.requestId !== id || typeof acknowledgement.summary !== 'string')) {
        throw new AppError(500, 'Stored acknowledgement is invalid. It has not been overwritten.');
      }
      const plan = await load(file(id, 'plan'), true);
      const preparation = await load(file(id, 'preparation'), true);
      try {
        for (const entry of [plan, preparation].filter(Boolean)) {
          if (entry.requestId !== id || !WORKFLOW_ACTORS.includes(entry.actor) || !Number.isFinite(Date.parse(entry.recordedAt))) throw new Error('Invalid workflow record.');
        }
        if (plan) validatePlan(plan.content);
        if (preparation) {
          if (!plan || preparation.planRecordedAt !== plan.recordedAt) throw new Error('Preparation requires its saved plan.');
          validateResult(preparation.content, record);
        }
      } catch { throw new AppError(500, 'Stored workflow is invalid. It has not been overwritten.'); }
      const progress = [];
      if (acknowledgement) progress.push({ action: 'Acknowledgement saved', recordedAt: acknowledgement.recordedAt });
      if (plan) progress.push({ action: `${plan.actor} task plan saved`, recordedAt: plan.recordedAt });
      if (preparation) progress.push({ action: 'Event preparation saved for review', recordedAt: preparation.recordedAt });
      const answerHistory = await history(id, 'answers');
      const answers = answerHistory.at(-1) ?? null;
      const continuationHistory = await history(id, 'continuation');
      const continuation = continuationHistory.at(-1) ?? null;
      const packageHistory = await history(id, 'packages');
      const publicationHistory = await history(id, 'publication');
      // Histories are immutable, but their heads can change between reads.
      // Retry before validation if any head advanced; never report a mixed snapshot.
      const heads = await Promise.all(['answers', 'continuation', 'packages', 'publication'].map((kind) => history(id, kind)));
      if (heads.some((entries, index) => entries.length !== [answerHistory, continuationHistory, packageHistory, publicationHistory][index].length)) {
        if (snapshotAttempt >= 4) throw new AppError(409, 'Saved state changed during read. Retry to obtain the latest snapshot.');
        return this.get(id, snapshotAttempt + 1);
      }
      const packageState = packageHistory.at(-1) ?? null;
      for (const item of publicationHistory) {
        if (!/^pkg_[a-z0-9_-]{1,40}$/.test(item.packageId) || typeof item.published !== 'boolean' ||
            (item.published && (!Number.isFinite(Date.parse(item.publishedAt)) || !/^[a-f0-9]{64}$/.test(item.contentHash) || !Number.isFinite(Date.parse(item.reviewedAt))))) {
          throw new AppError(500, 'Stored publication history is invalid; no records overwritten.');
        }
      }
      const context = { ...record, preparation, answerHistory, answers, continuation };
      try {
        for (const a of answerHistory) {
          if (!preparation) throw new Error('No preparation.');
          validateAnswers({ expectedRevision: a.revision - 1, entries: a.entries }, { ...context, continuation: null });
        }
        for (const c of continuationHistory) {
          if (!WORKFLOW_ACTORS.includes(c.actor)) throw new Error('Unknown workflow actor.');
          validateContinuation(c.content, { ...context, continuation: null });
        }
        for (const s of packageHistory) {
          if (!continuationHistory.some((c) => c.revision === s.continuationRevision)) throw new Error('Missing package origin.');
          for (const p of s.packages) validatePackage(p.content, { ...context, sourceAnswerRevision: s.answerRevision });
        }
      } catch { throw new AppError(500, 'Saved answer/package history is invalid; originals preserved.'); }
      if (answers) progress.push({ action: `Student answers revision ${answers.revision} saved — explicit resume required`, recordedAt: answers.recordedAt });
      if (continuation) progress.push({ action: `${continuation.actor} continuation revision ${continuation.revision} saved`, recordedAt: continuation.recordedAt });
      if (packageState) progress.push({ action: `Package edit/review revision ${packageState.revision} saved`, recordedAt: packageState.recordedAt });
      const stale = Boolean(continuation && continuation.content.answerRevision !== answers?.revision);
      const packages = packageState && packageState.continuationRevision === continuation?.revision ? packageState.packages : (continuation?.content.packages ?? []).map((content) => ({ content, review: null }));
      const latestPublication = new Map();
      for (const item of publicationHistory) latestPublication.set(item.packageId, item);
      return { ...record, status: answers && (!continuation || stale) ? 'answers_saved' : continuation ? 'packages_drafted' : preparation ? 'prepared' : plan ? 'planned' : acknowledgement ? 'acknowledged' : 'waiting', acknowledgement, plan, preparation, progress,
        answerHistory, answers, answerRevision: answers?.revision ?? 0, continuationHistory, continuation, continuationRevision: continuation?.revision ?? 0, continuationStale: stale,
        packageHistory, packageRevision: packageState?.revision ?? 0, publicationRevision: publicationHistory.length,
        packages: packages.map((p) => {
          const record = latestPublication.get(p.content.id);
          const published = Boolean(record?.published && p.review && !stale &&
            record.answerRevision === answers?.revision && record.continuationRevision === continuation?.revision &&
            record.reviewedAt === p.review.reviewedAt && record.contentHash === cardHash(p.content));
          return { ...p, reviewCurrent: Boolean(p.review && !stale), publication: { published, publishedAt: published ? record.publishedAt : null } };
        }) };
    },
    async saveAnswers(id, body) {
      return locked(id, async () => {
      const request = await this.get(id); validateAnswers(body, request);
      if (body.expectedRevision !== request.answerRevision) throw new AppError(409, 'Stale answer revision. Reload before saving.');
      await append(id, 'answers', body.expectedRevision, { entries: body.entries, actor: 'Student via browser' });
      return this.get(id);
      });
    },
    async continueTask(id, content, receiptRevision, actor = WORKFLOW_ACTORS[0]) {
      if (!WORKFLOW_ACTORS.includes(actor)) throw new AppError(400, 'Invalid workflow actor.');
      return locked(id, async () => {
      const request = await this.get(id);
      if (!content || typeof content !== 'object' || Array.isArray(content)) throw new AppError(400, 'Continuation content must be an object.');
      if (receiptRevision !== request.answerRevision || content.answerRevision !== request.answerRevision) throw new AppError(409, 'Answers changed since read. Read the latest request again.');
      if (request.continuation?.content.answerRevision === content.answerRevision) {
        if (JSON.stringify(request.continuation.content) === JSON.stringify(content)) return request;
        throw new AppError(409, 'Continuation for this answer revision exists; original preserved.');
      }
      validateContinuation(content, request);
      await append(id, 'continuation', request.continuationRevision, { content, actor });
      return this.get(id);
      });
    },
    async updatePackage(id, body, reviewing = false) {
      return locked(id, async () => {
      const allowed = reviewing ? ['expectedRevision', 'continuationRevision', 'packageId'] : ['expectedRevision', 'continuationRevision', 'packageId', 'content'];
      if (!body || Object.keys(body).some((k) => !allowed.includes(k)) || allowed.some((k) => !(k in body))) throw new AppError(400, 'Invalid package update fields.');
      revision(body.expectedRevision); revision(body.continuationRevision);
      const request = await this.get(id);
      if (!request.continuation || request.continuationStale || body.continuationRevision !== request.continuationRevision || body.expectedRevision !== request.packageRevision) throw new AppError(409, 'Stale package or answers. Reload and explicitly resume WorkBuddy if needed.');
      const packages = request.packages.map(({ content, review }) => ({ content, review }));
      const target = packages.find((p) => p.content.id === body.packageId);
      if (!target) throw new AppError(400, 'Unknown package ID.');
      if (reviewing) target.review = { reviewedAt: new Date().toISOString(), actor: 'Student content review only' };
      else {
        if (!body.content || typeof body.content !== 'object' || Array.isArray(body.content)) throw new AppError(400, 'Package content must be an object.');
        if (body.content.id !== body.packageId) throw new AppError(400, 'Package ID cannot be changed.');
        validatePackage(body.content, { ...request, sourceAnswerRevision: request.answerRevision });
        target.content = body.content; target.review = null;
      }
      await append(id, 'packages', body.expectedRevision, { packages, answerRevision: request.answerRevision, continuationRevision: request.continuationRevision, action: reviewing ? 'review' : 'edit', packageId: body.packageId, actor: 'Student via browser' });
      return this.get(id);
      });
    },
    async setPublication(id, body) {
      return locked(id, async () => {
        if (!body || typeof body !== 'object' || Array.isArray(body) ||
            Object.keys(body).some((key) => !['packageId', 'published', 'expectedRevision', 'continuationRevision'].includes(key)) ||
            !['packageId', 'published', 'expectedRevision', 'continuationRevision'].every((key) => key in body) ||
            typeof body.published !== 'boolean') throw new AppError(400, 'Invalid publication fields.');
        revision(body.expectedRevision); revision(body.continuationRevision);
        const request = await this.get(id);
        if (request.continuationStale || body.expectedRevision !== request.packageRevision ||
            body.continuationRevision !== request.continuationRevision) throw new AppError(409, 'Saved cards changed. Reload before changing publication.');
        const card = request.packages.find((item) => item.content.id === body.packageId);
        if (!card) throw new AppError(400, 'Unknown package ID.');
        if (body.published && !card.reviewCurrent) throw new AppError(409, 'Review this current card before publishing it.');
        if (card.publication.published === body.published) return request;
        await append(id, 'publication', request.publicationRevision, {
          packageId: body.packageId, published: body.published,
          publishedAt: body.published ? new Date().toISOString() : null,
          reviewedAt: body.published ? card.review.reviewedAt : null,
          contentHash: body.published ? cardHash(card.content) : null,
          answerRevision: request.answerRevision, continuationRevision: request.continuationRevision,
          actor: 'Student publication opt-in via browser',
        });
        return this.get(id);
      });
    },
    async listPublicListings() {
      const names = await readdir(directory);
      const ids = names.filter((name) => name.endsWith('.request.json'))
        .map((name) => name.slice(0, -'.request.json'.length)).filter((id) => ID_PATTERN.test(id));
      const listings = [];
      for (const id of ids) {
        const request = await this.get(id);
        const eventTitle = request.continuation?.content.event.facts.find((fact) => fact.field === 'eventName')?.value || 'Student event';
        for (const card of request.packages) {
          if (!card.publication.published) continue;
          const content = card.content;
          listings.push({
            id: createHash('sha256').update(`${id}:${content.id}`).digest('hex').slice(0, 24), packageId: content.id,
            eventTitle, summary: content.title, contributionType: content.contributionType,
            supportRequested: content.items.map((item) => item.quantity ? `${item.description} — ${item.quantity}` : item.description),
            amount: content.contributionType === 'cash' ? content.amount.value : '',
            currency: content.contributionType === 'cash' ? content.currency.value : '',
            draftReturn: content.benefits.map((benefit) => benefit.text),
            unknowns: [...content.outstanding], publishedAt: card.publication.publishedAt,
            sourceLabel: 'Organiser-reviewed draft; publication opt-in',
          });
        }
      }
      return listings;
    },
    async saveWorkflow(id, kind, content, actor = WORKFLOW_ACTORS[0]) {
      if (!WORKFLOW_ACTORS.includes(actor)) throw new AppError(400, 'Invalid workflow actor.');
      if (!['plan', 'preparation'].includes(kind)) throw new AppError(400, 'Invalid workflow operation.');
      const request = await this.get(id);
      if (kind === 'plan') validatePlan(content);
      else {
        if (!request.plan) throw new AppError(409, 'Save the task plan before the preparation result.');
        validateResult(content, request);
      }
      const record = { requestId: id, actor, recordedAt: new Date().toISOString(), content };
      if (kind === 'preparation') record.planRecordedAt = request.plan.recordedAt;
      try { await publishOnce(file(id, kind), record); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const existing = (await this.get(id))[kind];
        if (JSON.stringify(existing.content) !== JSON.stringify(content)) throw new AppError(409, 'A different workflow result is already saved. The original was preserved.');
      }
      return this.get(id);
    },
    async acknowledge(id, summary) {
      await this.get(id);
      text(summary, 'Acknowledgement summary', 1000);
      const record = { requestId: id, actor: 'WorkBuddy via local adapter', summary, recordedAt: new Date().toISOString() };
      try { await publishOnce(file(id, 'ack'), record); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const existing = (await this.get(id)).acknowledgement;
        if (existing.summary !== summary) throw new AppError(409, 'Already acknowledged. The existing acknowledgement was preserved.');
      }
      return this.get(id);
    },
  };
}
