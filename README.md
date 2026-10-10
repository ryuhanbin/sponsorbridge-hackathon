# SponsorBridge

**Helping UPM student organisers turn an event idea into a clear, reviewable sponsorship request.** Built with WorkBuddy; presented by Afiq.

Public source: https://github.com/ryuhanbin/sponsorbridge-hackathon

This repository contains a **local prototype**, not a hosted web application or an official UPM service. No sponsorship has been secured through the prototype and no businesses have been contacted.

![SponsorBridge request workspace](evidence/SponsorBridge-ui-new-request.png)

## Problem and implemented features

The prototype is motivated by the need to clarify support quantities and timing, explain authorised sponsor benefits, and prepare useful packages. This is a problem framing, not a claim based on market statistics or user research.

Implemented:
- Save an original event proposal and sponsorship goal without overwriting them.
- Have WorkBuddy read the saved request through a bounded local adapter, record a plan, extract source-linked facts, and ask clarification questions.
- Save student answers and, after an explicit WorkBuddy resume, persist updated event information and product/service package drafts.
- Edit package content through an advanced JSON editor and mark individual packages content-reviewed.
- Clear the affected package review after an edit; new answers make the continuation stale and invalidate current reviews.
- Optionally run the installed CodeBuddy CLI with a platform API key from the Activity view. One explicit run prepares the event or, after answers, drafts cards. The app checks the result against its source and package rules before saving it, and labels its author as CodeBuddy CLI.
- Responsive Overview, Clarifications, Packages, and Activity & handoff views, source evidence, and unsaved-change warnings.

**Content review is not university approval, sponsor acceptance, or an agreement.**

## Run locally

Require **Node.js 22 or newer**. Application files are **at the repository root**. There are **no runtime npm dependencies** and no `npm install` step is required.

From the repository root:

```sh
node server.mjs
```

Open **http://127.0.0.1:4317/**. Startup creates the local `data/` directory and its `.agent-key` if needed. Keep `data/` and all credentials out of commits; the generated local key must **never be committed or shared**. Run only one server against a given data directory. If port 4317 is occupied, stop your own known instance rather than starting a duplicate.

### View the pre-existing fictional demonstration

Use a fresh clone with no existing `data/` directory. Before starting the server, copy **only the JSON files** from `examples/fictional-swimming-clinic/`:

Git Bash / POSIX shell:

```sh
mkdir data
cp examples/fictional-swimming-clinic/*.json data/
node server.mjs
```

PowerShell:

```powershell
New-Item -ItemType Directory -Path data
Copy-Item -Path "examples/fictional-swimming-clinic/*.json" -Destination data
node server.mjs
```

Do not overwrite an existing local data directory. Do not copy keys, private records, or unrelated files into the example data. The server generates its own local key on startup.

Open:

http://127.0.0.1:4317/requests/req_65163d02-e331-4d92-aa41-10bde1d63f56

The included examples are **saved historical outputs from the WorkBuddy workflow**, not a new live agent run performed by copying them.

## Manual WorkBuddy handoff

For a new request or campaign starting point:
1. Save a proposal and goal in the browser.
2. Copy the request-specific instruction shown in Activity & handoff and start WorkBuddy manually in the repository workspace, with permission to use local tools.
3. WorkBuddy reads the current request through `adapter.mjs`, interprets the inputs, then saves a plan and preparation through validated operations.
4. Save answers in the browser. Explicitly resume WorkBuddy to reread the latest answers and save a continuation containing package drafts.
5. Review quantities, benefits, source passages, and outstanding conditions; edit and review the content before any proposed commitment.

Saving in the website **does not launch, wake, or resume WorkBuddy**. WorkBuddy performed actual interpretation and local read/write tool actions in the recorded demonstration, not merely code generation. Future runs require the user to start/resume it explicitly; organiser acceptance of this manual-handoff approach remains unresolved.

The adapter supports `read`, `ack`, `plan`, `preparation`, and `continuation`. Writes require a fresh read receipt bound to the request and answer revision. Receipts expire after 30 minutes and are invalid after a server restart; reread rather than reuse them. Do not write live workflow records directly.

## Optional CodeBuddy API key connection

The international CodeBuddy account provides a platform API key for CodeBuddy CLI. This route runs the CLI shipped with WorkBuddy as a **separate, tool-free model process**; it does not send a message to an existing WorkBuddy desktop conversation. The manual WorkBuddy route above remains available. The optional run may consume account credits, and key creation alone does not prove which credit pack it will use.

1. Open a saved request and choose **Activity & handoff → Use your CodeBuddy API key**.
2. Paste the platform key into the local form and choose **Connect key**. The server keeps it in memory only, clears the field, and never returns the key to the browser or saves it in `data/`.
3. Choose **Prepare event with AI** for a new request. Review and answer the resulting questions. Then choose **Draft sponsorship cards with AI**. Each click starts at most one run; the page displays its actual status.
4. Review the source-linked output and cards. A model response that fails validation is rejected; it is not shown as a completed draft.

The connection ends when the server restarts or you press **Disconnect key**. The CLI runs without file or command tools; the local server supplies the saved inputs and validates its returned JSON. The CLI path defaults to WorkBuddy's Windows bundle and can be set with `CODEBUDDY_CLI_PATH` for another supported installation. This repository contains no API key. Live model access still needs a user-entered key and a successful account call; the included tests use a fake model response and spend no credits.

![Optional local CodeBuddy connection](evidence/SponsorBridge-codebuddy-connection.png)

## Architecture

```text
Browser: public/index.html + public/styles.css + public/app.js
    | local HTTP requests and polling
Node service: server.mjs
    | validated workflow and package contracts
workflow.mjs + packages.mjs + store.mjs
    | immutable records and numbered revisions
Local data/ JSON files (outside public assets)

WorkBuddy -- manual tool execution --> adapter.mjs --> local Node service
Browser -- explicit AI run --> model-bridge.mjs --> CodeBuddy CLI model --> validated local records
```

The service uses Node built-ins, loopback-only HTTP, browser-session tokens, local-key adapter authorisation, and read receipts. Disk records preserve original input, answers, continuations, package edits, and content reviews. This is bounded local authorisation, **not cryptographic proof of WorkBuddy identity** or a production student account system. The conversation's actual tool actions establish the historical execution evidence.

## Fictional swimming-clinic example

**First Splash Swimming Clinic**, proposed by fictional Blue Lane, is not a real or approved UPM event. Its saved drafts request:
- **48 sealed 500 ml drinking-water bottles** for a planning assumption of 24 participants.
- **A loan of 12 kickboards**, with proposed same-day return.
- **One qualified swimming coach for three hours**; qualifications and safe supervision remain unchecked.

Only a **written thank-you from the student organising team** is offered. No logo rights, naming rights, exclusivity, campus access, university endorsement, cash amount, or tax eligibility is promised.

The proposed clinic is **7 November 2026, 09:00–12:00** at **Demo Training Pool**. The date is proposed, the headcount is an estimate, and pool reservation/access and event permissions remain unconfirmed. Contribution availability, acceptance, delivery/handover, equipment-loan responsibilities, and coaching safety arrangements also remain outstanding.

![Historical drinking-water package screenshot](evidence/SponsorBridge-ui-package-card.png)

Screenshots capture the earlier demonstration; their displayed review counts are not a live status feed.

## Tests and evidence

Run the existing Node checks from the repository root:

```sh
node --test test/stage1.test.mjs test/preparation.test.mjs test/packages.test.mjs test/model-bridge.test.mjs
```

- **11 October 2026:** all **23 Node checks** passed, including an isolated fake-model run that exercises the local connection, preparation, answers, cards, source attribution, and key non-disclosure. It does not verify a live paid model call.
- **10 October 2026:** earlier WorkBuddy reports recorded **63 Chrome UI checks**, including responsive widths and isolated in-memory mutation checks. These are historical results, **not freshly rerun browser checks**; mocked UI actions are not live WorkBuddy execution.
- `evidence/` contains the existing request, overview, and package screenshots. Browser verification tooling is separate from the runtime and is not needed to start the app.

## Current limitations and next steps

Working scope is **preparation, clarification answers, editable packages, and content review**. Business matching, personalised sponsor pitches, and complete campaign export remain **planned**, not implemented.

The prototype is local, single-user and single-mutation-process. It is not multi-user production infrastructure. The optional website dispatch targets CodeBuddy CLI, not the WorkBuddy desktop conversation. There is no outreach, payment processing, hosted deployment, or live university integration. Exact source quotes support traceability but do not prove that an edited claim is semantically justified. Student review remains necessary. No student usability study, full screen-reader audit, or physical-device assurance is claimed.

No businesses were contacted, no funds were processed, and no university approval or sponsorship commitment was obtained.
