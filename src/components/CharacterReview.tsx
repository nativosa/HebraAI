import React from "react";
import type { Confidence, Gender } from "@/lib/translation/characters";
import { Badge, Button, Card, inputClass, linkButton } from "./ui";

// Type-only import: the characters module is server code.
const GENDERS: Gender[] = ["male", "female", "unknown"];

// A row of the sheet: what the analysis found, edited by the user.
// Confidence and evidence come from the analysis and are shown read-only.
export type CharacterRow = {
  key: number;
  name: string;
  hebrewName: string;
  aliases: string[];
  gender: Gender;
  confidence?: Confidence;
  evidence?: number[];
};

type Props = {
  notes: string;
  onNotes: (notes: string) => void;
  rows: CharacterRow[];
  onChange: (rows: CharacterRow[]) => void;
  canAnalyze: boolean;
  analyzing: boolean;
  // Error or summary of the last analysis.
  error: string | null;
  summary: string | null;
  onAnalyze: () => void;
  onCancel: () => void;
  // Evidence: the cue's label ("#12") and scrolling the review to it.
  cueLabel: (id: number) => string;
  onShowCue: (id: number) => void;
};

const CONFIDENCE_DOT: Record<Confidence, string> = { high: "bg-ok", medium: "bg-faint", low: "bg-warn-bar" };
const CONFIDENCE_TONE = { high: "ok", medium: "neutral", low: "warn" } as const;

let nextKey = 1_000_000;

export default function CharacterReview({
  notes,
  onNotes,
  rows,
  onChange,
  canAnalyze,
  analyzing,
  error,
  summary,
  onAnalyze,
  onCancel,
  cueLabel,
  onShowCue,
}: Props) {
  const update = (key: number, patch: Partial<CharacterRow>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const remove = (key: number) => onChange(rows.filter((r) => r.key !== key));
  const add = () => onChange([...rows, { key: nextKey++, name: "", hebrewName: "", aliases: [], gender: "unknown" }]);
  const analyzed = rows.filter((r) => r.confidence);

  return (
    <Card title="Story & characters">
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5 text-[12.5px] font-medium text-fg-2">
          Story notes <span className="sr-only">(optional)</span>
          <textarea
            aria-label="Story notes"
            value={notes}
            maxLength={4000}
            rows={2}
            onChange={(e) => onNotes(e.target.value)}
            placeholder="e.g. Dana and Mia are sisters; Alex is a man."
            className={`${inputClass} resize-y py-1.5 leading-snug font-normal`}
          />
        </label>

        <div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12.5px] font-medium text-fg-2">Characters</span>
            <div className="flex items-center gap-2">
              {rows.length > 0 && !analyzing && (
                <button type="button" onClick={() => onChange([])} className={`${linkButton} text-muted`}>
                  Clear
                </button>
              )}
              {analyzing ? (
                <Button size="sm" onClick={onCancel}>
                  Cancel analysis
                </Button>
              ) : (
                <Button size="sm" disabled={!canAnalyze} onClick={onAnalyze}>
                  Analyze characters
                </Button>
              )}
            </div>
          </div>
          <p className="mt-1 text-xs text-muted">
            {analyzing ? "Analyzing…" : "Genders and Hebrew spellings used by the translation. Check them first."}
          </p>
          {summary && !analyzing && <p className="mt-1 text-xs text-muted">{summary}</p>}
          {error && (
            <p role="alert" className="mt-1.5 text-xs text-danger">
              {error}
            </p>
          )}

          {rows.length > 0 && (
            <table className="mt-2 w-full table-fixed border-collapse text-[13px]">
              <colgroup>
                <col className="w-[34%]" />
                <col className="w-[28%]" />
                <col />
                <col className="w-6" />
              </colgroup>
              <thead>
                <tr className="text-left text-[11.5px] text-muted">
                  <th className="px-0.5 pb-1 font-medium">Name</th>
                  <th className="px-0.5 pb-1 font-medium">Hebrew</th>
                  <th className="px-0.5 pb-1 font-medium">Gender</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} data-character={r.name}>
                    <td className="relative p-0.5">
                      {r.confidence && (
                        <span
                          title={`${r.confidence} confidence`}
                          className={`absolute top-1/2 left-2 h-1.5 w-1.5 -translate-y-1/2 rounded-full ${CONFIDENCE_DOT[r.confidence]}`}
                        />
                      )}
                      <input
                        aria-label="Name"
                        value={r.name}
                        onChange={(e) => update(r.key, { name: e.target.value })}
                        className={`${inputClass} h-7.5 ${r.confidence ? "pl-4.5" : "pl-2"} pr-1.5 text-[13px]`}
                      />
                    </td>
                    <td className="p-0.5">
                      <input
                        aria-label="Hebrew name"
                        dir="rtl"
                        lang="he"
                        value={r.hebrewName}
                        onChange={(e) => update(r.key, { hebrewName: e.target.value })}
                        className={`${inputClass} text-he h-7.5 px-2 text-[13.5px]`}
                      />
                    </td>
                    <td className="p-0.5">
                      <select
                        aria-label="Gender"
                        value={r.gender}
                        onChange={(e) => update(r.key, { gender: e.target.value as Gender })}
                        className={`${inputClass} h-7.5 px-1.5 text-[13px]`}
                      >
                        {GENDERS.map((g) => (
                          <option key={g}>{g}</option>
                        ))}
                      </select>
                    </td>
                    <td className="p-0.5 text-center">
                      <button
                        type="button"
                        aria-label={`Remove ${r.name || "character"}`}
                        onClick={() => remove(r.key)}
                        className="h-7 w-6 rounded text-faint hover:text-danger focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none"
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="mt-1.5 flex items-center justify-between gap-2">
            {!analyzing && (
              <button type="button" onClick={add} className={linkButton}>
                Add character
              </button>
            )}
          </div>

          {analyzed.length > 0 && (
            <details className="mt-2 rounded-lg border border-line bg-surface-2 text-xs" data-analysis-details>
              <summary className="cursor-pointer px-2.5 py-1.5 font-medium text-fg-2 focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none">
                Confidence and evidence
              </summary>
              <ul className="flex flex-col gap-1.5 px-2.5 pb-2">
                {analyzed.map((r) => (
                  <li key={r.key} className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-muted">
                    <span className="font-medium text-fg-2">{r.name || "(unnamed)"}</span>
                    <Badge tone={CONFIDENCE_TONE[r.confidence!]}>{r.confidence} confidence</Badge>
                    {r.aliases.length > 0 && <span>aka {r.aliases.join(", ")}</span>}
                    {r.evidence?.length ? (
                      <span>
                        cues{" "}
                        {r.evidence.map((id, i) => (
                          <React.Fragment key={id}>
                            {i > 0 && ", "}
                            <button type="button" className={linkButton} onClick={() => onShowCue(id)}>
                              {cueLabel(id)}
                            </button>
                          </React.Fragment>
                        ))}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </div>
    </Card>
  );
}
