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
| `npm run baseline:check` | Offline regression check: no OpenAI calls (see below) |
| `npm run baseline:capture -- --overwrite` | Explicitly regenerate the legacy baseline |
| `npm run srt:inspect <file>` | Print the structure of an SRT file (cue count, indices, BOM/EOL, hash) |
| `npm run srt:compare <a> <b>` | Compare two SRT files' cue numbering and timestamps (ignores text) |

## Regression baseline (free, offline)

`npm run baseline:check` builds the app, starts it on `127.0.0.1:3123` with a
fake API key and a local fake OpenAI server, runs every file in
`fixtures/srt/` through `/api/translate`, and compares the output byte-for-byte
with `fixtures/legacy-baseline/`. The baseline records current behaviour,
**including known defects** (`fixtures/KNOWN_DEFECTS.md`), so a pass means
"unchanged", not "correct". See `fixtures/README.md`.

Real (paid) translations are never run automatically. Put private subtitle
files and real outputs in `fixtures/private/`, which is git-ignored.

## Security notes

- The OpenAI key is used only server-side.
- `dev` and `start` bind to `127.0.0.1`, so the app is not reachable from other
  machines on your network.
- **Localhost binding is not authentication.** If you ever deploy this app or
  expose it publicly (port forwarding, tunnels, hosting), add authentication
  and rate limiting first. Otherwise anyone who can reach it can spend your
  OpenAI credits.
