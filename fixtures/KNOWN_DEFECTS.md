# Known defects of the original app

`fixtures/legacy-baseline/` and `fixtures/legacy-requests.json` record what the
original (Stage 0) app did, including the defects below. They are **immutable
history**: fixes never regenerate them. Current expectations live in
`fixtures/expected/`, and every difference from the legacy references is
listed with its defect id in `fixtures/expected/changes.json` (enforced by
`npm run baseline:check`).

Outputs use the offline fake translator, which prefixes every translated cue
with `[HE] `. A cue without the prefix would be a silent English fallback.

Fixed defects are covered by tests named `D# (fixed)`; open ones are pinned by
tests named `LEGACY D#` (search `tests/` for the id).

| # | Fixture | Original behaviour | Expected correct behaviour | Status |
|---|---|---|---|---|
| D1 | `duplicate-index.srt` | Two cues numbered `2` collide: both get the translation of the second one ("A different second line."). | Each cue keeps its own translation; cues are keyed by an internal sequential id. | **Fixed (Stage 2).** Cues get internal ids; translations are matched by id. Repeated numbers are kept in the output and reported. |
| D2 | `quirks.srt` | Cue with `.` timestamp separators is dropped. | Accept `.` and `,`; output uses `,`. | **Fixed (Stage 2).** Accepted, normalised to `,`, reported as recovered. |
| D3 | `quirks.srt` | Cue without a number line is dropped. | Cue is kept and numbered. | **Fixed (Stage 2).** Kept; the output is renumbered 1..N when any cue has no number; reported. |
| D4 | `quirks.srt` | Cue with a single-digit hour (`0:00:07,000`) is dropped. | Accepted and normalised to `00:00:07,000`. | **Fixed (Stage 2).** Also short milliseconds (`,5` → `,500`). |
| D5 | `quirks.srt` | A blank line inside cue 5 splits it; the text after the blank line ("and text after it.") is lost. | Text is kept (blank line treated as part of the cue or reported). | **Fixed (Stage 2) — reported.** Merging it into the previous cue would be a guess, so the text is not translated and is reported as unparsed with its line number. |
| D6 | `quirks.srt` | Cue 6 with empty text is dropped silently. | Dropped cues are counted and reported to the user. | **Fixed (Stage 2).** Removed and reported with its line number. |
| D7 | `sfx-mixed.srt` (sfx-on) | Parentheticals inside dialogue are stripped (`I said (whispers) come here.` → `I said come here.`; `(Mary) You're late.` → `You're late.`); `♪ lyrics ♪` cue removed entirely. | Behaviour documented and configurable; speaker labels / lyrics policy explicit. | **Documented (Stage 2), configurability deferred.** Policy kept: `(…)`, `[…]`, `♪…♪` (incl. speaker labels and lyrics) are removed; see README. Nested brackets are now removed completely. |
| D8 | `multiline-italics.srt` (sfx-on) | `<i>` tags are removed whenever sound-effect removal is on. | Formatting tags preserved independently of SFX removal. | **Fixed (Stage 2).** Tags are kept around remaining dialogue; empty tags removed. |
| D9 | `crlf-bom.srt` | Input BOM and CRLF line endings are not preserved; output is always LF without BOM. | Unchanged by default (compatibility); optional BOM/CRLF export. | Open — planned for Stage 5. |
| D10 | `sfx-mixed.srt` (sfx-on) | Removed cues leave gaps in numbering (4, 5, 7, 8). | Unchanged by default; optional renumbering on export. | Open — planned for Stage 5 (gaps kept by design). |
| D11 | all | Glossary field is sent by the UI but ignored by the server (not visible in fake output). | Glossary terms are included in the prompt. | **Fixed (Stage 2).** Appended to the unchanged base instructions; limits 100 terms / 4,000 characters. |
| D12 | all | Missing items silently fall back to the English text (not triggered by the fake translator). | Missing items are retried, then reported. | **Fixed (Stage 2).** Missing/invalid translations are re-requested once; still missing → partial result, never "complete". |
