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
| `npm run baseline:capture -- --overwrite` | Explicitly regenerate the legacy baseline and request fingerprints |
| `npm run golden:capture -- --overwrite` | Explicitly regenerate the unit tests' golden values from the running app |
| `npm run check:openai-endpoint` | Offline check that only the official OpenAI endpoint can be used outside test mode |
| `npm run srt:inspect <file>` | Print the structure of an SRT file (cue count, indices, BOM/EOL, hash) |
| `npm run srt:compare <a> <b>` | Compare two SRT files' cue numbering and timestamps (ignores text) |

## Code layout

| Path | Responsibility |
|---|---|
| `src/app/api/translate/route.ts` | HTTP only: key check, upload guards, error responses, NDJSON stream |
| `src/lib/srt/` | Pure SRT handling: `parse`, `build`, `sound-effects` filtering |
| `src/lib/translation/options.ts` | Reads and sanitizes the form options |
| `src/lib/translation/prompt.ts` | Instructions and the Responses API request for one chunk |
| `src/lib/translation/response.ts` | Parses model output and applies it to cues (English fallback) |
| `src/lib/translation/pipeline.ts` | Chunks of 60 cues, sequential requests, progress / complete / error events; the model call is passed in |
| `src/lib/openai-client.ts` | OpenAI client pinned to the official endpoint |

## Tests (free, offline)

`npm test` runs Vitest. No test touches the network: the pipeline and route
tests use an in-process stub model that answers exactly like the offline fake
server, and the route tests replace the OpenAI client module and disable
`fetch`.

- Expected values are literals, the Stage 0 baseline files, or golden values
  captured from the running app before the refactor
  (`tests/golden/legacy-golden.json`); no snapshots are written by test runs.
- Known defects are pinned by tests named `LEGACY D#`
  (`fixtures/KNOWN_DEFECTS.md`); they describe current behaviour and are
  inverted when a defect is fixed.

## Regression baseline (free, offline)

`npm run baseline:check` builds the app, starts it on `127.0.0.1:3123` with a
fake API key and a local fake OpenAI server, runs every file in
`fixtures/srt/` through `/api/translate`, and compares the output byte-for-byte
with `fixtures/legacy-baseline/`. It also compares hashes of every request
sent to the fake OpenAI server (model, instructions, input, schema) with
`fixtures/legacy-requests.json`. The baseline records current behaviour,
**including known defects** (`fixtures/KNOWN_DEFECTS.md`), so a pass means
"unchanged", not "correct". See `fixtures/README.md`.

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
