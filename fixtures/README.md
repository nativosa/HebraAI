# Fixtures

| Path | Contents |
|---|---|
| `srt/` | Small synthetic English SRT inputs (no copyrighted material). Byte-exact: see `/.gitattributes`. |
| `legacy-baseline/` | Output of the current app for each input, with sound-effect removal on and off, produced by the offline fake translator. **Regression reference, not a correctness reference** — see `KNOWN_DEFECTS.md`. |
| `private/` | Git-ignored. Put your real subtitle files and real (paid) translation outputs here. |

## Verifying (free, offline, no OpenAI calls)

```bash
npm run baseline:check
```

Builds the app, starts it on `127.0.0.1:3123` against a local fake OpenAI server
(`scripts/fake-openai.mjs`) with a fake API key, runs every fixture through
`/api/translate`, and compares results byte-for-byte with `legacy-baseline/`.
It never writes baseline files.

## Regenerating (explicit only)

Only when a behaviour change is intended and reviewed:

```bash
npm run baseline:capture -- --overwrite
```

Without `--overwrite` the capture refuses to replace existing files. Commit the
regenerated files together with the change that caused them and update
`KNOWN_DEFECTS.md`.

## Optional real-output check (paid, manual, never automated)

1. Put your file in `fixtures/private/`, translate it in the UI, save the result
   next to it (e.g. `fixtures/private/episode.he.srt`).
2. `npm run srt:compare fixtures/private/episode.srt fixtures/private/episode.he.srt`

This compares cue count, numbering and timestamps only (no text is printed).
With sound-effect removal on, removed cues show up as expected differences.
