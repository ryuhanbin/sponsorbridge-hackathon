// Validation only. Interpretation and planning are performed in WorkBuddy,
// never by this module, the browser, or a prewritten event-output fixture.
import { AppError, text } from './store.mjs';

export const EVENT_FIELDS = [
  'eventName', 'organiser', 'purpose', 'activities', 'audience', 'date', 'venue',
  'attendance', 'budget', 'currency', 'supportNeeds', 'supportQuantities',
  'sponsorshipBenefits', 'approvals', 'taxEligibility',
];
export function object(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((k) => !allowed.includes(k)) || allowed.some((k) => !(k in value))) {
    throw new AppError(400, `${label} has missing or unexpected fields.`);
  }
}
export function list(value, label, min, max) {
  if (!Array.isArray(value) || value.length < min || value.length > max) throw new AppError(400, `${label} must contain ${min}-${max} items.`);
}
export function sources(value, request) {
  list(value, 'Sources', 1, 8);
  for (const item of value) {
    if (item?.source === 'answer') {
      object(item, ['source', 'quote', 'questionId', 'revision'], 'Answer source');
      const snapshot = request.answerHistory?.find((a) => a.revision === item.revision);
      const answer = snapshot?.entries.find((a) => a.questionId === item.questionId);
      if (!answer || answer.state !== 'confirmed' || (request.sourceAnswerRevision !== undefined && item.revision !== request.sourceAnswerRevision)) throw new AppError(400, 'Answer source must reference a confirmed answer in the selected revision.');
      text(item.quote, 'Source quote', 2000);
      if (!answer.value.includes(item.quote)) throw new AppError(400, 'Answer quote must match the saved answer.');
    } else {
      object(item, ['source', 'quote'], 'Source');
      if (!['proposal', 'goal'].includes(item.source)) throw new AppError(400, 'Source must be proposal, goal or confirmed answer.');
      text(item.quote, 'Source quote', 2000);
      if (!request[item.source].includes(item.quote)) throw new AppError(400, 'Source quote must be an exact passage in the saved proposal or goal.');
    }
  }
}
export function validatePlan(value) {
  object(value, ['steps'], 'Plan');
  list(value.steps, 'Plan steps', 1, 6);
  value.steps.forEach((step) => text(step, 'Plan step', 500));
  return value;
}
export function validateResult(value, request) {
  object(value, ['facts', 'summary', 'questions', 'checklist'], 'Preparation result');
  list(value.facts, 'Event facts', EVENT_FIELDS.length, EVENT_FIELDS.length);
  const seen = new Set();
  for (const fact of value.facts) {
    object(fact, ['field', 'value', 'sources'], 'Fact');
    if (!EVENT_FIELDS.includes(fact.field) || seen.has(fact.field)) throw new AppError(400, 'Event fields must each appear exactly once.');
    seen.add(fact.field);
    if (typeof fact.value !== 'string') throw new AppError(400, 'Fact value must be text; use an empty string for unknown information.');
    if (fact.value === '') {
      if (!Array.isArray(fact.sources) || fact.sources.length !== 0) throw new AppError(400, 'Unknown information must have an empty value and no sources.');
    } else {
      text(fact.value, 'Fact value', 1000);
      sources(fact.sources, request);
    }
  }
  list(value.summary, 'Event summary', 1, 8);
  for (const sentence of value.summary) {
    object(sentence, ['text', 'sources'], 'Summary sentence');
    text(sentence.text, 'Summary sentence', 1000); sources(sentence.sources, request);
  }
  list(value.questions, 'Clarification questions', 0, 15);
  const questionIds = new Set();
  for (const q of value.questions) {
    object(q, ['id', 'field', 'question', 'reason'], 'Question');
    text(q.id, 'Question ID', 40);
    if (questionIds.has(q.id) || !EVENT_FIELDS.includes(q.field)) throw new AppError(400, 'Question IDs must be unique and fields recognised.');
    questionIds.add(q.id);
    if (value.facts.find((f) => f.field === q.field).value !== '') throw new AppError(400, 'Clarification questions in this slice must refer to empty fields.');
    text(q.question, 'Question', 600); text(q.reason, 'Question reason', 600);
  }
  list(value.checklist, 'Preparation checklist', 1, 15);
  const checklistIds = new Set();
  for (const item of value.checklist) {
    object(item, ['id', 'task', 'status', 'dependsOnFields'], 'Checklist item');
    text(item.id, 'Checklist ID', 40);
    if (checklistIds.has(item.id) || item.status !== 'not_started') throw new AppError(400, 'Checklist IDs must be unique; future preparation tasks must be not_started.');
    checklistIds.add(item.id);
    text(item.task, 'Checklist task', 1000);
    list(item.dependsOnFields, 'Checklist dependencies', 0, EVENT_FIELDS.length);
    if (item.dependsOnFields.some((f) => !EVENT_FIELDS.includes(f)) || new Set(item.dependsOnFields).size !== item.dependsOnFields.length) throw new AppError(400, 'Checklist dependencies must be unique recognised fields.');
  }
  return value;
}
