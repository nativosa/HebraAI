import React from "react";
import type { Confidence, Gender } from "@/lib/translation/characters";

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
  rows: CharacterRow[];
  onChange: (rows: CharacterRow[]) => void;
  canAnalyze: boolean;
  analyzing: boolean;
  // Error or summary of the last analysis.
  error: string | null;
  summary: string | null;
  onAnalyze: () => void;
  onCancel: () => void;
};

let nextKey = 1_000_000;

export default function CharacterReview({ rows, onChange, canAnalyze, analyzing, error, summary, onAnalyze, onCancel }: Props) {
  const update = (key: number, patch: Partial<CharacterRow>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const remove = (key: number) => onChange(rows.filter((r) => r.key !== key));
  const add = () => onChange([...rows, { key: nextKey++, name: "", hebrewName: "", aliases: [], gender: "unknown" }]);

  return (
    <div className="mt-3 rounded-xl border border-slate-200 p-3">
      <div className="flex items-center justify-between">
        <label className="text-xs font-semibold text-slate-700">Characters (optional)</label>
        {rows.length > 0 && !analyzing && (
          <button type="button" onClick={() => onChange([])} className="text-xs text-slate-500 underline">
            Clear
          </button>
        )}
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Genders and Hebrew name spellings used by the translation. Check them before translating.
      </p>

      <div className="mt-2 flex gap-2">
        <button
          type="button"
          disabled={!canAnalyze || analyzing}
          onClick={onAnalyze}
          className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {analyzing ? "Analyzing…" : "Analyze characters"}
        </button>
        {analyzing && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800"
          >
            Cancel analysis
          </button>
        )}
      </div>

      {summary && !analyzing && <div className="mt-1 text-[11px] text-slate-400">{summary}</div>}
      {error && <div className="mt-2 text-xs text-red-700">{error}</div>}

      {rows.length > 0 && (
        <table className="mt-3 w-full text-xs">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="pb-1 font-medium">Name</th>
              <th className="pb-1 font-medium">Hebrew</th>
              <th className="pb-1 font-medium">Gender</th>
              <th className="pb-1 font-medium" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="align-top" data-character={r.name}>
                <td className="pr-1 pb-1">
                  <input
                    aria-label="Name"
                    value={r.name}
                    onChange={(e) => update(r.key, { name: e.target.value })}
                    className="w-full rounded border border-slate-200 px-1.5 py-1"
                  />
                  {r.confidence && (
                    <div className="mt-0.5 text-[10px] text-slate-400">
                      {r.confidence} confidence
                      {r.evidence?.length ? ` · cues ${r.evidence.join(", ")}` : ""}
                      {r.aliases.length ? ` · aka ${r.aliases.join(", ")}` : ""}
                    </div>
                  )}
                </td>
                <td className="pr-1 pb-1">
                  <input
                    aria-label="Hebrew name"
                    dir="rtl"
                    value={r.hebrewName}
                    onChange={(e) => update(r.key, { hebrewName: e.target.value })}
                    className="w-full rounded border border-slate-200 px-1.5 py-1"
                  />
                </td>
                <td className="pr-1 pb-1">
                  <select
                    aria-label="Gender"
                    value={r.gender}
                    onChange={(e) => update(r.key, { gender: e.target.value as Gender })}
                    className="rounded border border-slate-200 bg-white px-1 py-1"
                  >
                    {GENDERS.map((g) => (
                      <option key={g}>{g}</option>
                    ))}
                  </select>
                </td>
                <td className="pb-1">
                  <button type="button" aria-label="Remove" onClick={() => remove(r.key)} className="px-1 py-1 text-slate-400">
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {!analyzing && (
        <button type="button" onClick={add} className="mt-2 text-xs text-slate-600 underline">
          Add character
        </button>
      )}
    </div>
  );
}
