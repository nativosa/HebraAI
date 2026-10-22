# Fixtures

| Path | Contents |
|---|---|
| `srt/` | Small synthetic English SRT inputs (no copyrighted material). Byte-exact: see `/.gitattributes`. |
| `legacy-baseline/` | **Immutable Stage 0 reference.** Output of the original app for each input, with sound-effect removal on and off, produced by the offline fake translator. Records the original behaviour including its defects (`KNOWN_DEFECTS.md`). Never regenerated. |
| `legacy-requests.json` | **Immutable Stage 0 reference.** Fingerprints of every request the original app sent to the (fake) OpenAI API: per case and request, the subtitle item count and SHA-256 hashes of canonical JSON (sorted keys) of the whole body, `model`, `instructions`, `input` and `text` (schema). Hashes only — no prompts, subtitle text or keys. |
| `expected/` | **Current expectations**: one output file per case (same naming as `legacy-baseline/`) and `requests.json` (same format as `legacy-requests.json`). |
| `expected/changes.json` | Every intentional difference between `expected/` and the legacy references, with its reason (defect id such as `D1`, or `new`). `outputs` is keyed by file name, `requests` by case name. |
| `private/` | Git-ignored. Put your real subtitle files and real (paid) translation outputs here; a private evaluation dataset in `private/eval-cases/` (see `eval/README.md`); evaluation outputs saved with `--save-outputs` land in `private/eval-outputs/`. |

## Verifying (free, offline, no OpenAI calls)

```bash
npm run baseline:check
```

Builds the app, starts it on `127.0.0.1:3123` against a local fake OpenAI server
(`scripts/fake-openai.mjs`) with a fake API key, runs every fixture through
`/api/translate`, and compares results byte-for-byte with `expected/`. It also
sends `basic.srt` with every prompt option combination (`PROMPT_VARIANTS` in
`scripts/app-server.mjs`) and compares the fingerprints of all requests with
`expected/requests.json`; a mismatch names the case, request number and changed
field only.

Every output and request case is then compared with the legacy references. A
case may differ from legacy only if `expected/changes.json` lists it with a
reason; an unlisted difference or a listed case that no longer differs (stale
entry) fails the check. It never writes any file.

## Regenerating (explicit only)

Only when a behaviour change is intended and reviewed:

```bash
npm run baseline:capture -- --overwrite
```

Without `--overwrite` the capture refuses to replace existing files. It writes
`expected/` (outputs and `requests.json`) only; the legacy references are never
written. Update `expected/changes.json` and `KNOWN_DEFECTS.md` in the same
commit as the change that caused the difference.

The unit tests' golden values (`tests/golden/legacy-golden.json`: instructions
per option combination, one full request body, observed NDJSON lines) were
captured from the original app with `npm run golden:capture -- --overwrite`.
They are Stage 0 references too: tests keep using the parts that must not
change (e.g. the base prompt).

## Optional real-output check (paid, manual, never automated)

1. Put your file in `fixtures/private/`, translate it in the UI, save the result
   next to it (e.g. `fixtures/private/episode.he.srt`).
2. `npm run srt:compare fixtures/private/episode.srt fixtures/private/episode.he.srt`

This compares cue count, numbering and timestamps only (no text is printed).
With sound-effect removal on, removed cues show up as expected differences.
