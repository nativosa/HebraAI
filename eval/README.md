# Translation-quality evaluation

Measures English → Hebrew translation quality where Hebrew grammar depends on
who speaks to whom: speaker and addressee gender, singular/plural, names, and
context across 60-cue chunks. Checks are deterministic word-form checks — no
LLM judge, no exact-string matching.

## Commands

| Command | API calls | What it does |
|---|---|---|
| `npm run eval:estimate` | none | Prints the plan: cases per category, modes, requests, tokens, cost |
| `npm run eval:offline` | none (fake server) | Runs everything through the real app and route against the local fake OpenAI server; verifies the plumbing (all cases complete, requests as planned, estimate ≥ usage, reports text-free). The fake translator fails the quality checks by design. |
| `npm run eval:real` | **paid** | Real OpenAI run. Refuses unless `HEBRAAI_REAL_EVAL=1`, prices are configured and you confirm interactively. Only with explicit approval. |
| `npm run eval:compare -- a.json b.json` | none | Baseline vs candidate: accuracy per category and dimension, regressions and improvements by case id, requests, tokens, time, cost |

Options: `--modes`, `--cases <ids|categories>`, `--sample <n>` (stratified
across categories), `--repeat <n>`, `--cases-dir <dir>`, `--budget-usd <x>`,
`--margin <x>`, `--save-outputs`, `--yes`. See the header of `scripts/eval.mjs`.

Only implemented modes run (currently `classic`); `context`,
`context+chars` and `context+oracle` are declared for Stage 3 and rejected
until the app supports them.

## Cost safeguards (real runs)

- The plan is printed first: selected cases and modes, estimated requests,
  input/output tokens, and cost — translation and character analysis
  separately.
- Prices come from `OPENAI_PRICE_INPUT_PER_MTOK` / `OPENAI_PRICE_OUTPUT_PER_MTOK`
  (environment or `.env.local`); a real run refuses without them.
- Per-run budget `--budget-usd` (default **$0.50**). A case starts only if
  `spent + estimate × margin` (default margin 1.5) fits; at the first case
  that does not fit, the run stops and lists the cases not started.
- Token estimates are conservative (≈3 characters per input token, ≈2 per
  Hebrew output token, plus a reasoning allowance equal to the output).
- **The budget is an estimate, not a billing limit**: usage is known only
  after each request, and requests in flight, repairs and retries may still
  be billed.
- Start small: `--sample 10` covers every category.

## Privacy

Reports (`eval/results/`, git-ignored) and console output contain case ids,
categories, check results and metrics only — never subtitle or model text.
`--save-outputs` writes model outputs to `fixtures/private/eval-outputs/`
(git-ignored) for manual review.

## Datasets

- `eval/cases/synthetic/` — 86 synthetic cases written for this project
  (no copyrighted text), with hand-written Hebrew references.
- A **private dataset** of real subtitle excerpts can live in
  `fixtures/private/eval-cases/` (git-ignored) and be run with
  `--cases-dir fixtures/private/eval-cases`. Its reports are labelled
  `private` and, like all reports, contain no text.

## Case format

See the header of `eval/lib/cases.mjs` and the checks in `eval/lib/checks.mjs`.
Each case carries a hand-written correct `reference` and a deliberately
`wrong` output; `npm test` requires the reference to pass every check and the
wrong output to fail exactly `wrongFails` — this validates the checks
themselves.

Rules:
- Character gender never implies who speaks a line. Unlabeled alternating
  dialogue accepts either form; inventing a speaker name fails
  (`attribution`).
- Unknown identities accept neutral phrasing; only consistency is checked.
- `oracle.characters` may contain only `name`, `gender`, `aliases`,
  `hebrewName`. The oracle mode sends exactly these; references, wrong
  outputs, checks and expected forms never reach a request, and there are no
  per-cue speaker assignments (enforced by validation and tests).

## Interpreting results

Automatic checks cover grammatical form. Before concluding that a mode is
better, review a sample of outputs manually for meaning preservation and
natural Hebrew (`--save-outputs`), and run `--repeat` to see variance.
