// This page is a local, fictional preview. It sends no data and makes no model call.
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
const cards = [...document.querySelectorAll('.event-card')];
const resultSummary = document.querySelector('#result-summary');
const briefField = document.querySelector('#matching-brief');
const briefDetails = document.querySelector('#brief-details');
const copyButton = document.querySelector('#copy-brief');
const copyStatus = document.querySelector('#copy-status');

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
  briefField.value = buildBrief(offer, interests);
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
render();
