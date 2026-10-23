# HebraAI Subtitles

Personal, single-user tool that translates English `.srt` subtitle files into
Hebrew with the OpenAI API. Upload, adjust settings, translate, review
side by side, and download.

Built with Next.js (App Router), React and Tailwind CSS.

## Setup

```bash
npm install
cp .env.example .env.local   # then set OPENAI_API_KEY
npm run dev                  # http://127.0.0.1:3000
```

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `OPENAI_API_KEY` | yes | Read only by the server route `src/app/api/translate/route.ts`. Never sent to the browser. |
| `MAX_FILE_SIZE_BYTES` | no | Upload size limit in bytes. Default `524288` (512 KB). Larger files get HTTP 413. |
| `OPENAI_PRICE_INPUT_PER_MTOK`, `OPENAI_PRICE_OUTPUT_PER_MTOK`, `OPENAI_PRICE_CACHED_INPUT_PER_MTOK` | no | USD per 1M tokens for the cost estimate shown after a translation (and in evaluation runs). No defaults; without input and output prices no cost is shown. An estimate, not a billing limit. |
| `MAX_ATTEMPTS_PER_CHUNK` | no | Maximum OpenAI requests per 60-cue chunk, counting the first request, repairs and retries. Integer 1–20, default `6`. |

`.env.local` is git-ignored. Never commit real keys.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server on `127.0.0.1:3000` |
| `npm run build` / `npm start` | Production build / server on `127.0.0.1:3000` |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript check (`tsc --noEmit`) |
| `npm test` | Vitest unit and route tests (offline, see below) |
| `npm run baseline:check` | Offline regression check: no OpenAI calls (see below) |
| `npm run baseline:capture -- --overwrite` | Explicitly regenerate `fixtures/expected/` (outputs and request fingerprints); the legacy references are never rewritten |
| `npm run golden:capture -- --overwrite` | Regenerate the Stage 0 golden values (only for an intended base-prompt change) |
| `npm run eval:estimate` / `eval:offline` / `eval:compare` | Translation-quality evaluation: plan and cost estimate, free run against the fake server, comparison (see `eval/README.md`) |
| `npm run eval:real` | Real (paid) evaluation — refuses unless `HEBRAAI_REAL_EVAL=1`, prices are set and you confirm; per-run budget |
| `npm run ui:smoke` | Browser smoke test of the real UI against the fake OpenAI server (needs Chrome, see below) |
| `npm run check:openai-endpoint` | Offline check that only the official OpenAI endpoint can be used outside test mode |
| `npm run srt:inspect <file>` | Print the structure of an SRT file (cue count, indices, BOM/EOL, hash) |
| `npm run srt:compare <a> <b>` | Compare two SRT files' cue numbering and timestamps (ignores text) |

## How a translation behaves

- **Input file.** Cues are identified internally by position, so repeated or
  missing cue numbers no longer mix up translations. Irregular input that can
  be handled safely (`.` in timestamps, one-digit hours, missing number lines,
  cues not separated by a blank line, empty cues) is recovered; content that
  cannot be parsed safely (text without a timestamp, invalid timing lines) is
  not guessed at. Both are listed under "Input file notes" with line numbers.
- **Output.** Cues keep their input order and original numbers; only when a
  cue had no number is the output renumbered 1..N. Byte order mark and CRLF
  line endings are not preserved (output is UTF-8, LF).
- **Complete vs partial.** "Download SRT" appears only when every cue was
  translated. If some cues could not be translated, the result is marked
  **partial**: those cues keep their English text, the panel lists their
  numbers, timings and reasons, and the button reads **Download Partial SRT**
  (`translated.he.PARTIAL.srt`). If nothing was translated, an error is shown.
- **Checking the model's answer.** Each answer must contain exactly one
  non-empty translation for every cue sent. Names, English terms and text
  identical to the source are accepted. Missing, empty or conflicting
  translations, invalid JSON and cut-off answers are re-requested once (only
  the affected cues, or the chunk in two halves). Refusals and content-filter
  results are never re-requested; those cues are reported as untranslated.
- **Temporary errors.** Timeouts, connection errors, HTTP 408/409/429 and 5xx
  are retried up to 3 times per request with exponential backoff (1 s, 2 s,
  4 s …, ±20 %, or the server's `retry-after`); the UI shows the countdown.
  Permanent errors (other 4xx, exhausted quota) are not retried. A request
  that keeps failing stops the job; chunks already translated are kept as a
  partial result. All attempts for a chunk count against
  `MAX_ATTEMPTS_PER_CHUNK` (default 6).
- **Cancel.** Stops the job at once: no further chunks, retries or repairs,
  and the OpenAI request in flight is aborted. Nothing from the cancelled run
  is kept. A request already sent to OpenAI may still be billed.
- **Glossary.** One `term = translation` per line (e.g. `John = ג׳ון`); up
  to 100 terms and 4,000 characters. The terms are sent with the
  instructions; lines without a term or translation are ignored and reported.
- **Remove sound effects.** Drops `(…)`, `[…]` and `♪…♪` annotations
  anywhere in a cue (including parenthetical speaker labels such as
  `(Mary)` and song lyrics), and cues that contain nothing else. Formatting
  tags such as `<i>` are kept around the remaining dialogue.
- **Translation mode.** *Classic* (default) sends exactly the original
  requests. *Context-aware* adds Hebrew gender and number rules to the
  instructions and sends the 8 cues before and 4 cues after each chunk as
  read-only context (they carry no ids, so they can never be returned as
  translations); about 20 % more input tokens, same number of requests.
  Optional **story notes** (up to 4,000 characters) are sent with the
  instructions.
- **Characters (context-aware only, optional).** *Analyze characters* sends
  one extra request with the whole subtitle text before sound-effect
  removal (speaker labels are evidence; up to 200,000 characters, later
  cues are left out and the summary says so). It lists names, Hebrew
  spellings, gender (male / female / unknown), confidence and evidence cue
  numbers. Review and edit the table (gender, Hebrew spelling, add/remove
  rows) before translating; the edited list is sent with every chunk. The
  analysis can be cancelled; it is limited to 3 requests (retries
  included); if it fails, translation works without it.

## Code layout

| Path | Responsibility |
|---|---|
| `src/app/api/translate/route.ts` | HTTP only: key check, upload guards, error responses, NDJSON stream, cancellation |
| `src/app/api/characters/route.ts` | Optional character analysis (same guards, JSON response, cancellation) |
| `src/lib/server-env.ts` | Server settings from the environment (file size, attempts, prices) |
| `src/lib/srt/` | Pure SRT handling: `parse` (cue ids, recovered / unparsed input), `build`, `sound-effects` filtering |
| `src/lib/translation/options.ts` | Reads and sanitizes the form options, incl. the glossary |
| `src/lib/translation/prompt.ts` | Instructions (classic and context) and the Responses API request for one chunk |
| `src/lib/translation/characters.ts` | Character sheet validation, analysis request, answer validation and retries |
| `src/lib/translation/response.ts` | Validates a model answer per cue (refusal, incomplete, invalid, missing, empty …) |
| `src/lib/translation/retry.ts` | Which errors are temporary, backoff delays, abortable sleep |
| `src/lib/translation/pipeline.ts` | Chunks of 60 cues, sequential requests, repair, retries, request budget, cancellation, final event; the model call is passed in |
| `src/lib/translation/report.ts` | Report sent with the final event (counts, line numbers, timings — no subtitle text) and its UI texts |
| `src/lib/translation/stream-client.ts`, `run-control.ts` | Browser side: reading the NDJSON stream, cancelling and discarding stale runs |
| `src/lib/openai-client.ts` | OpenAI client pinned to the official endpoint; SDK retries off, 120 s timeout per attempt |

## Tests (free, offline)

`npm test` runs Vitest. No test touches the network: the pipeline and route
tests use an in-process stub model that answers exactly like the offline fake
server, and the route tests replace the OpenAI client module and disable
`fetch`.

- Expected values are literals, the expected output files
  (`fixtures/expected/`), or golden values captured from the original app
  (`tests/golden/legacy-golden.json`, e.g. the base prompt); no snapshots
  are written by test runs. Retries and backoff use injected sleep and random
  functions, so they run instantly and deterministically.
- Known defects (`fixtures/KNOWN_DEFECTS.md`) are covered by tests named
  `D# (fixed)`; the ones still open are pinned as `LEGACY D#`.

## Regression baseline (free, offline)

`npm run baseline:check` builds the app, starts it on `127.0.0.1:3123` with a
fake API key and a local fake OpenAI server, runs every file in
`fixtures/srt/` through `/api/translate`, and compares the output byte-for-byte
with `fixtures/expected/`. It also compares hashes of every request sent to the
fake OpenAI server (model, instructions, input, schema) with
`fixtures/expected/requests.json`. Every difference from the immutable Stage 0
references (`fixtures/legacy-baseline/`, `fixtures/legacy-requests.json`) must
be listed with its reason in `fixtures/expected/changes.json`.

It then runs reliability scenarios against a scripted fake server (missing
items, refusals, content filter, invalid JSON, 429/5xx with retries, permanent
errors) and checks cancellation before and during the response stream: the
OpenAI request in flight must be aborted and no further request sent. See
`fixtures/README.md`.

## Browser smoke test (free, offline)

`npm run ui:smoke` builds the app, starts it in offline test mode against the
local fake OpenAI server on a free `127.0.0.1` port, and drives the real UI in
a headless browser: a successful translation and download, a partial result
("Download Partial SRT", untranslated cue with timing and reason),
cancelling while an OpenAI request is in flight (no late result, request
aborted, no further requests), a new translation after cancelling, and context mode (character analysis
and its cancellation, editing the sheet, the context request). No
OpenAI calls; no extra npm packages (it uses the Chrome DevTools protocol).

**Prerequisite:** Google Chrome, Chromium or Microsoft Edge installed. The
script looks in the standard install locations and on `PATH`; set
`CHROME_PATH` to use a specific binary. It uses a temporary browser profile
in the OS temp directory and removes it, the browser, the app and the fake
server afterwards, also when a check fails. Exit code 0 = all checks passed,
1 = a check failed or an error occurred, 2 = no browser found.

Real (paid) translations are never run automatically. Put private subtitle
files and real outputs in `fixtures/private/`, which is git-ignored.

## Security notes

- The OpenAI key is used only server-side.
- The server always calls the official endpoint (`https://api.openai.com/v1`);
  an inherited `OPENAI_BASE_URL` is ignored. Only the offline harness can
  change it, via `HEBRAAI_OFFLINE_TEST_MODE=1`, which accepts nothing but a
  loopback `http://127.0.0.1` / `http://[::1]` URL together with the fake test
  key; any other combination makes the translate route fail closed without
  sending a request (`npm run check:openai-endpoint`).
- `dev` and `start` bind to `127.0.0.1`, so the app is not reachable from other
  machines on your network.
- **Localhost binding is not authentication.** If you ever deploy this app or
  expose it publicly (port forwarding, tunnels, hosting), add authentication
  and rate limiting first. Otherwise anyone who can reach it can spend your
  OpenAI credits.

## Troubleshooting

**Windows: `npm run build` fails with `Invariant: Expected workUnitAsyncStorage
to have a store`.** The terminal's current directory uses different letter case
from the folder on disk (e.g. `cd C:\git\HebraAI` when the folder is
`C:\GIT\HebraAI`). npm's `next.cmd` shim launches Next.js from the on-disk
spelling while the project root keeps the typed one, so Node loads two copies
of Next's internal modules. Open the terminal in the exactly-cased path, or
rename the folder so its case matches what you type.
