# Fixtures

| Path | Contents |
|---|---|
| `srt/` | Small synthetic English SRT inputs (no copyrighted material). Byte-exact: see `/.gitattributes`. |
| `legacy-baseline/` | Output of the current app for each input, with sound-effect removal on and off, produced by the offline fake translator. **Regression reference, not a correctness reference** — see `KNOWN_DEFECTS.md`. |
| `legacy-requests.json` | Fingerprints of every request the app sends to the (fake) OpenAI API during the check: per case and request, the subtitle item count and SHA-256 hashes of canonical JSON (sorted keys) of the whole body, `model`, `instructions`, `input` and `text` (schema). Hashes only — no prompts, subtitle text or keys. Proves refactors keep the model, prompt, payload and schema unchanged. |
| `private/` | Git-ignored. Put your real subtitle files and real (paid) translation outputs here. |

## Verifying (free, offline, no OpenAI calls)

```bash
npm run baseline:check
```

Builds the app, starts it on `127.0.0.1:3123` against a local fake OpenAI server
(`scripts/fake-openai.mjs`) with a fake API key, runs every fixture through
`/api/translate`, and compares results byte-for-byte with `legacy-baseline/`.
It also sends `basic.srt` with every prompt option combination
(`PROMPT_VARIANTS` in `scripts/app-server.mjs`) and compares the fingerprints of
all requests with `legacy-requests.json`; a mismatch names the case, request
number and changed field only. It never writes baseline files.

## Regenerating (explicit only)

Only when a behaviour change is intended and reviewed:

```bash
npm run baseline:capture -- --overwrite
```

Without `--overwrite` the capture refuses to replace existing files. It rewrites
both `legacy-baseline/` and `legacy-requests.json`. Commit the regenerated files
together with the change that caused them and update `KNOWN_DEFECTS.md`.

The unit tests' golden values (`tests/golden/legacy-golden.json`: instructions
per option combination, one full request body, observed NDJSON lines) were
captured from the running app the same way, with
`npm run golden:capture -- --overwrite`. Regenerate them only together with an
intended prompt or streaming change.

## Optional real-output check (paid, manual, never automated)

1. Put your file in `fixtures/private/`, translate it in the UI, save the result
   next to it (e.g. `fixtures/private/episode.he.srt`).
2. `npm run srt:compare fixtures/private/episode.srt fixtures/private/episode.he.srt`

This compares cue count, numbering and timestamps only (no text is printed).
With sound-effect removal on, removed cues show up as expected differences.
