// Local marketplace preview. Only explicitly published, reviewed card projections are fetched.
const offerLabels = Object.freeze({
  'drinking-water': 'sealed drinking water',
  'sports-equipment': 'a sports equipment loan',
  coaching: 'qualified swimming coaching',
  'reusable-drinkware': 'reusable bottles',
  'workshop-materials': 'repair-workshop materials',
});

const interestLabels = Object.freeze({
  health: 'health and activity',
  learning: 'learning new skills',
  sustainability: 'sustainability',
  repair: 'repair and reuse',
});

const events = Object.freeze({
  swimming: {
    title: 'First Splash Swimming Clinic',
    offers: ['drinking-water', 'sports-equipment', 'coaching'],
    interests: ['health', 'learning'],
  },
  fair: {
    title: 'Campus Sustainability Fair',
    offers: ['reusable-drinkware', 'workshop-materials'],
    interests: ['sustainability', 'repair'],
  },
});

const offerInput = document.querySelector('#offer');
const interestInputs = [...document.querySelectorAll('input[name="interest"]')];
const cards = [...document.querySelectorAll('#sample-grid .event-card')];
const resultSummary = document.querySelector('#result-summary');
const briefField = document.querySelector('#matching-brief');
const briefDetails = document.querySelector('#brief-details');
const copyButton = document.querySelector('#copy-brief');
const copyStatus = document.querySelector('#copy-status');
const publishedGrid = document.querySelector('#published-grid');
const publishedStatus = document.querySelector('#published-status');
const publishedCount = document.querySelector('#published-count');
const refreshButton = document.querySelector('#refresh-listings');
let publishedListings = [];

function node(tag, className, value) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (value !== undefined) element.textContent = value;
  return element;
}

function section(label, value, extraClass = '') {
  const wrapper = node('div', `card-section ${extraClass}`.trim());
  wrapper.append(node('span', 'section-label', label), node('p', '', value || 'Not specified in the reviewed card.'));
  return wrapper;
}

function requestedSupport(listing) {
  const items = Array.isArray(listing.supportRequested) ? listing.supportRequested.join('; ') : listing.supportRequested || '';
  if (listing.contributionType !== 'cash') return items;
  const amount = listing.amount ? `${listing.currency ? `${listing.currency} ` : ''}${listing.amount}` : 'Amount not confirmed';
  return [items, amount].filter(Boolean).join('; ');
}

function renderPublished() {
  publishedGrid.replaceChildren();
  publishedCount.textContent = `${String(publishedListings.length).padStart(2, '0')} PUBLISHED`;
  publishedStatus.textContent = publishedListings.length
    ? 'These cards were explicitly shared by organisers. They are draft offers, not confirmed sponsorships.'
    : 'No organiser cards have been published yet. Explore the fictional examples below.';
  for (const [index, listing] of publishedListings.entries()) {
    const article = node('article', 'event-card');
    const topline = node('div', 'card-topline');
    topline.append(node('span', '', `${String(index + 1).padStart(2, '0')} / ORGANISER CARD`), node('span', 'draft-badge', 'REVIEWED DRAFT'));
    const heading = node('div', 'card-heading');
    const kind = { products: 'PRODUCT SUPPORT', services: 'SERVICE SUPPORT', cash: 'CASH SUPPORT' }[listing.contributionType] || 'PUBLISHED OPPORTUNITY';
    heading.append(node('p', 'event-type', kind), node('h3', '', listing.eventTitle || 'Untitled event'), node('p', '', listing.summary || 'Read the requested support and draft return below.'));
    const fit = node('div', 'fit-panel');
    fit.append(node('span', 'section-label', 'WORKBUDDY COMPARISON'), node('strong', 'fit-title', 'Assess this card in WorkBuddy'), node('p', 'published-fit-copy', 'The reviewed wording is included in the matching brief below. This page does not assign an AI score.'));
    article.append(topline, heading, fit,
      section('SUPPORT REQUESTED', requestedSupport(listing)),
      section('DRAFT RETURN', Array.isArray(listing.draftReturn) ? listing.draftReturn.join('; ') : listing.draftReturn),
      section('CHECK BEFORE COMMITTING', Array.isArray(listing.unknowns) ? listing.unknowns.join('; ') : listing.unknowns, 'card-unknowns'),
      node('div', 'card-footer', listing.sourceLabel || 'Source: organiser-published card in this local prototype.'));
    publishedGrid.append(article);
  }
}

async function loadPublished() {
  refreshButton.disabled = true;
  publishedStatus.textContent = 'Checking published cards…';
  try {
    const response = await fetch('/api/marketplace/listings', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data.listings)) throw new Error('Invalid listing response');
    publishedListings = data.listings;
    renderPublished();
    render();
  } catch {
    publishedListings = [];
    publishedGrid.replaceChildren();
    publishedCount.textContent = 'UNAVAILABLE';
    publishedStatus.textContent = 'Published cards could not be loaded. Refresh to try again; the fictional examples remain available.';
    render();
  } finally {
    refreshButton.disabled = false;
  }
}

function selectedInterests() {
  return interestInputs.filter((input) => input.checked).map((input) => input.value);
}

function assess(event, offer, interests) {
  const matchingInterests = interests.filter((interest) => event.interests.includes(interest));
  const offerMatches = Boolean(offer && event.offers.includes(offer));
  const reasons = [];
  if (offerMatches) reasons.push(`The organiser's draft requests ${offerLabels[offer]}.`);
  else if (offer) reasons.push(`This draft does not request ${offerLabels[offer]}.`);
  if (matchingInterests.length) reasons.push(`Shared interest: ${matchingInterests.map((item) => interestLabels[item]).join(', ')}.`);
  else if (interests.length) reasons.push('None of your selected interests appears in this demo listing.');
  if (!offer && !interests.length) reasons.push('Choose an offer or interest to see a transparent comparison.');
  const title = offerMatches && matchingInterests.length ? 'Offer and interest align'
    : offerMatches ? 'Your offer matches a request'
    : matchingInterests.length && offer ? 'Interest aligns; offer differs'
    : matchingInterests.length ? 'Shared interest'
    : offer || interests.length ? 'No direct selected match' : 'Choose what you can offer';
  return { title, reasons, offerMatches };
}

function buildBrief(offer, interests) {
  const offerText = offer ? offerLabels[offer] : 'Not selected';
  const interestText = interests.length ? interests.map((item) => interestLabels[item]).join(', ') : 'Not selected';
  return `Manual WorkBuddy matching task — FICTIONAL DEMO ONLY\n\nBusiness preferences:\n- Can contribute: ${offerText}\n- Interests: ${interestText}\n\nCompare only these supplied fictional event opportunities:\n\n1. First Splash Swimming Clinic. A proposed beginner-university-student clinic for water confidence and supervised basic strokes. Proposed for 7 November 2026, 09:00–12:00, at Demo Training Pool. Requested in-kind support: 48 sealed 500 ml drinking-water bottles for a planning assumption of 24 participants; a loan of 12 kickboards with proposed same-day return; or one qualified swimming coach for three hours. The only draft benefit is a written thank-you from the student organising team. Pool reservation/access, event permissions, availability, handover, coach qualifications and supervision are not confirmed. There is no sponsor acceptance, logo right, university endorsement, cash amount, or tax claim.\n\n2. Campus Sustainability Fair. A fictional proposed campus fair with in-kind requests for reusable bottles or repair-workshop materials. Quantities, date, venue, approvals, contribution availability, and tax status are unconfirmed. Draft benefits, based on a fictional organiser answer, are a logo on the event page and a verbal thank-you during opening remarks, subject to review. No sponsor has accepted.\n\nTask: Compare the business preferences with each event's stated requests. Explain which event is the better starting conversation and why, citing the supplied facts. Separate a concrete contribution fit from a shared-interest fit. State every relevant unknown and any assumption. If neither is a good fit, say so. Suggest questions the business and organiser should answer before making a commitment. Do not invent audience numbers, dates, approvals, benefits, monetary value, tax status, business identity, or sponsor acceptance. Do not contact anyone, promise sponsorship, or claim this page's fixed-rule preview is an AI result. Return a concise comparison and one cautious next step.`;
}

function buildPublishedBrief(offer, interests) {
  const offerText = offer ? offerLabels[offer] : 'Not selected';
  const interestText = interests.length ? interests.map((item) => interestLabels[item]).join(', ') : 'Not selected';
  const asText = (value) => Array.isArray(value) ? value.join('; ') : value || 'Not specified';
  const listings = publishedListings.map((listing, index) => `${index + 1}. ${listing.eventTitle || 'Untitled event'}\nSummary: ${asText(listing.summary)}\nSupport requested: ${requestedSupport(listing) || 'Not specified'}\nDraft return: ${asText(listing.draftReturn)}\nUnconfirmed details: ${asText(listing.unknowns)}\nSource: ${listing.sourceLabel || 'Organiser-published reviewed draft'}`).join('\n\n');
  return `Manual WorkBuddy matching task — ORGANISER-PUBLISHED DRAFTS\n\nBusiness preferences:\n- Can contribute: ${offerText}\n- Interests: ${interestText}\n\nAssess only these organiser-published, reviewed card drafts. The event details are unverified; this local prototype may contain fictional demo content:\n\n${listings}\n\nTask: Assess each stated request against the business preferences. If there is more than one, rank the better starting conversation and explain why, citing only the supplied facts. Separate concrete contribution fit from shared-interest fit. State unknowns and assumptions. If no card fits, say so. Suggest questions the business and organiser should answer before a commitment. Do not invent audience numbers, dates, approvals, benefits, monetary value, tax status, business identity, or sponsor acceptance. Do not contact anyone or promise sponsorship. Return a concise comparison and one cautious next step.`;
}

function render() {
  const offer = offerInput.value;
  const interests = selectedInterests();
  let offerMatchCount = 0;
  for (const card of cards) {
    const event = events[card.dataset.event];
    const result = assess(event, offer, interests);
    if (result.offerMatches) offerMatchCount += 1;
    card.querySelector('[data-fit-title]').textContent = result.title;
    const list = card.querySelector('[data-fit-reasons]');
    list.replaceChildren(...result.reasons.map((reason) => {
      const item = document.createElement('li');
      item.textContent = reason;
      return item;
    }));
  }
  resultSummary.textContent = offer
    ? `${offerMatchCount} of 2 fictional events request ${offerLabels[offer]}. Review all details before deciding.`
    : interests.length ? 'Interest overlap is shown below. Choose an offer to check contribution fit.'
      : 'Choose an offer to see why each event may fit.';
  briefField.value = publishedListings.length ? buildPublishedBrief(offer, interests) : buildBrief(offer, interests);
  copyStatus.textContent = '';
}

async function copyBrief() {
  const brief = briefField.value;
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
    await navigator.clipboard.writeText(brief);
    copyStatus.textContent = 'Brief copied. Paste it into WorkBuddy when you are ready.';
  } catch {
    briefDetails.open = true;
    briefField.focus();
    briefField.select();
    copyStatus.textContent = 'Clipboard unavailable. The full brief is selected below for manual copying.';
  }
}

offerInput.addEventListener('change', render);
for (const input of interestInputs) input.addEventListener('change', render);
copyButton.addEventListener('click', copyBrief);
refreshButton.addEventListener('click', loadPublished);
render();
loadPublished();
