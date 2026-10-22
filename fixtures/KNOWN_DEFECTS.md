# Known defects captured in the legacy baseline

`fixtures/legacy-baseline/` records what the app **does today**, not what it
**should** do. The defects below are intentionally preserved there so that
refactors can prove "no behaviour change". Each one is a **future correctness
expectation**: when the fix lands (in the listed stage), the legacy baseline for
the affected fixture is regenerated explicitly and the new behaviour is covered
by dedicated correctness tests.

Outputs use the offline fake translator, which prefixes every translated cue
with `[HE] `. A cue without the prefix would be a silent English fallback.

Each defect is also pinned by a unit test named `LEGACY D#` under `tests/`
(search for the id). Those tests assert today's behaviour; when a fix lands,
invert them rather than deleting them.

| # | Fixture | Legacy behaviour (preserved) | Expected correct behaviour | Stage |
|---|---|---|---|---|
| D1 | `duplicate-index.srt` | Two cues numbered `2` collide: both get the translation of the second one ("A different second line."). | Each cue keeps its own translation; cues are keyed by an internal sequential id. | 2 |
| D2 | `quirks.srt` | Cue with `.` timestamp separators is dropped. | Accept `.` and `,`; output uses `,`. | 2 |
| D3 | `quirks.srt` | Cue without a number line is dropped. | Cue is kept and numbered. | 2 |
| D4 | `quirks.srt` | Cue with a single-digit hour (`0:00:07,000`) is dropped. | Accepted and normalised to `00:00:07,000`. | 2 |
| D5 | `quirks.srt` | A blank line inside cue 5 splits it; the text after the blank line ("and text after it.") is lost. | Text is kept (blank line treated as part of the cue or reported). | 2 |
| D6 | `quirks.srt` | Cue 6 with empty text is dropped silently. | Dropped cues are counted and reported to the user. | 2 |
| D7 | `sfx-mixed.srt` (sfx-on) | Parentheticals inside dialogue are stripped (`I said (whispers) come here.` → `I said come here.`; `(Mary) You're late.` → `You're late.`); `♪ lyrics ♪` cue removed entirely. | Behaviour documented and configurable; speaker labels / lyrics policy explicit. | 2 |
| D8 | `multiline-italics.srt` (sfx-on) | `<i>` tags are removed whenever sound-effect removal is on. | Formatting tags preserved independently of SFX removal. | 2 |
| D9 | `crlf-bom.srt` | Input BOM and CRLF line endings are not preserved; output is always LF without BOM. | Unchanged by default (compatibility); optional BOM/CRLF export. | 5 |
| D10 | `sfx-mixed.srt` (sfx-on) | Removed cues leave gaps in numbering (4, 5, 7, 8). | Unchanged by default; optional renumbering on export. | 5 |
| D11 | all | Glossary field is sent by the UI but ignored by the server (not visible in fake output). | Glossary terms are included in the prompt. | 2 |
| D12 | all | Missing items silently fall back to the English text (not triggered by the fake translator). | Missing items are retried, then reported. | 2 |
