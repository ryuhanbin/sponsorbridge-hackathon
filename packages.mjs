// Validated data contracts only; WorkBuddy authors the interpretation/packages.
import { AppError, text } from './store.mjs';
import { object, list, sources, validateResult } from './workflow.mjs';
export function revision(value, label = 'Revision') {
  if (!Number.isSafeInteger(value) || value < 0) throw new AppError(400, `${label} must be a non-negative integer.`);
  return value;
}
export function answerQuestions(request) {
  return request.preparation?.content.questions ?? [];
}
export function validateAnswers(body, request) {
  object(body, ['expectedRevision', 'entries'], 'Answer update'); revision(body.expectedRevision);
  const questions = answerQuestions(request);
  if (!request.preparation) throw new AppError(409, 'Wait for WorkBuddy clarification questions first.');
  list(body.entries, 'Answers', questions.length, questions.length);
  const seen = new Set();
  for (const a of body.entries) {
    object(a, ['questionId', 'state', 'value'], 'Answer');
    if (!questions.some((q) => q.id === a.questionId) || seen.has(a.questionId)) throw new AppError(400, 'Each saved question requires exactly one answer state.');
    seen.add(a.questionId);
    if (a.state === 'confirmed') text(a.value, 'Answer', 2000);
    else if (a.state !== 'not_confirmed' || a.value !== '') throw new AppError(400, 'Not confirmed yet requires an empty value.');
  }
  return body;
}
function sourced(value, request, label) {
  object(value, ['text', 'sources'], label); text(value.text, label, 1000); sources(value.sources, request);
}
export function validatePackage(p, request) {
  object(p, ['id', 'title', 'contributionType', 'items', 'amount', 'currency', 'deadline', 'benefits', 'outstanding', 'draftStatus'], 'Package');
  if (!/^pkg_[a-z0-9_-]{1,40}$/.test(p.id)) throw new AppError(400, 'Invalid package ID.');
  text(p.title, 'Package title', 100);
  if (!['products', 'services', 'cash'].includes(p.contributionType) || p.draftStatus !== 'draft') throw new AppError(400, 'Contribution type and draft status must be explicit.');
  for (const field of ['amount', 'currency', 'deadline']) {
    object(p[field], ['value', 'sources'], field);
    if (p[field].value === '') {
      if (!Array.isArray(p[field].sources) || p[field].sources.length) throw new AppError(400, 'Unknown values must have no sources.');
    } else { text(p[field].value, field, 400); sources(p[field].sources, request); }
  }
  list(p.items, 'Package items', p.contributionType === 'cash' ? 0 : 1, 10);
  for (const item of p.items) {
    object(item, ['description', 'quantity', 'sources'], 'Package item');
    text(item.description, 'Item description', 500);
    if (typeof item.quantity !== 'string' || item.quantity.length > 200) throw new AppError(400, 'Quantity must be text; unknown is empty.');
    sources(item.sources, request);
  }
  if (p.contributionType === 'cash') {
    if (p.items.length) throw new AppError(400, 'Cash and in-kind support must remain separate.');
  } else if (p.amount.value !== '' || p.currency.value !== '') throw new AppError(400, 'In-kind packages must not contain a cash amount or require a currency.');
  list(p.benefits, 'Benefits', 0, 8);
  for (const benefit of p.benefits) {
    sourced(benefit, request, 'Benefit');
    if (!benefit.sources.some((s) => s.source === 'answer' && request.preparation.content.questions.concat(request.continuation?.content.event.questions ?? []).some((q) => q.id === s.questionId && q.field === 'sponsorshipBenefits'))) throw new AppError(400, 'Benefits require an organiser answer to a sponsorship-benefits question.');
  }
  list(p.outstanding, 'Outstanding assumptions/permissions', 0, 12);
  p.outstanding.forEach((s) => text(s, 'Outstanding assumption/permission', 700));
  if ((!p.deadline.value || p.items.some((i) => !i.quantity) || (p.contributionType === 'cash' && !p.amount.value)) && !p.outstanding.length) throw new AppError(400, 'Missing package details must remain visible in outstanding assumptions.');
  return p;
}
export function validateContinuation(value, request) {
  object(value, ['answerRevision', 'event', 'resolutions', 'packages'], 'Continuation'); revision(value.answerRevision);
  const context = { ...request, sourceAnswerRevision: value.answerRevision };
  validateResult(value.event, context);
  const answered = request.answerHistory.find((a) => a.revision === value.answerRevision);
  if (!answered) throw new AppError(409, 'Save clarification answers before continuing.');
  const original = request.preparation.content.questions;
  list(value.resolutions, 'Question resolutions', original.length, original.length);
  const seen = new Set();
  for (const r of value.resolutions) {
    object(r, ['questionId', 'status', 'reason', 'sources'], 'Resolution');
    if (!original.some((q) => q.id === r.questionId) || seen.has(r.questionId) || !['resolved', 'remaining', 'not_needed_for_draft'].includes(r.status)) throw new AppError(400, 'Resolution must identify each original question exactly once.');
    seen.add(r.questionId); text(r.reason, 'Resolution reason', 600);
    if (r.status === 'resolved') {
      if (answered.entries.find((a) => a.questionId === r.questionId)?.state !== 'confirmed') throw new AppError(400, 'Only confirmed answers can resolve a question.');
      sources(r.sources, context);
      if (!r.sources.some((s) => s.source === 'answer' && s.questionId === r.questionId)) throw new AppError(400, 'Resolved question must cite its answer.');
    } else if (!Array.isArray(r.sources) || r.sources.length) throw new AppError(400, 'Unresolved/not-required resolutions have no asserted answer sources.');
  }
  list(value.packages, 'Package drafts', 0, 3);
  const ids = new Set();
  for (const p of value.packages) { validatePackage(p, context); if (ids.has(p.id)) throw new AppError(400, 'Package IDs must be unique.'); ids.add(p.id); }
  return value;
}
