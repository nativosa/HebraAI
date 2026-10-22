import React from "react";
import type { PartialSummary } from "@/lib/translation/report";

type Props = {
  canTranslate: boolean;
  busy: boolean;
  progress: number;
  error: string | null;
  // Notes about the input file (recovered or unparsed content).
  notices: string[];
  // Shown while busy, e.g. a retry after a temporary error.
  status: string | null;
  // Requests, tokens, time and cost estimate of the last run.
  usage: string | null;
  // The last run was cancelled by the user.
  cancelled: boolean;
  // Set when the result is partial.
  partial: PartialSummary | null;
  onTranslate: () => void;
  onCancel: () => void;
};

export default function TranslatePanel({
  canTranslate,
  busy,
  progress,
  error,
  notices,
  status,
  usage,
  cancelled,
  partial,
  onTranslate,
  onCancel,
}: Props) {
  return (
    <div className="mt-6">
      <div className="text-sm font-semibold text-slate-800">3) Translate</div>

      <button
        type="button"
        disabled={!canTranslate}
        onClick={onTranslate}
        className="mt-3 w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? "Translating…" : "Translate to Hebrew"}
      </button>

      {busy && (
        <button
          type="button"
          onClick={onCancel}
          className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 shadow-sm"
        >
          Cancel
        </button>
      )}

      <div className="mt-3">
        <div className="h-2 w-full rounded-full bg-slate-100">
          <div
            className="h-2 rounded-full bg-slate-900 transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="mt-2 text-xs text-slate-500">
          {busy
            ? status ?? "Working…"
            : cancelled
            ? "Cancelled. Nothing was kept. A request already sent to OpenAI may still be billed."
            : partial
            ? "Partial result. Review the preview, then click Download Partial SRT."
            : progress === 100
            ? "Done. Review the preview, then click Download."
            : "Idle"}
        </div>
      </div>

      {!busy && usage && <div className="mt-1 text-[11px] text-slate-400">{usage}</div>}

      {partial && (
        <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3">
          <div className="text-sm font-semibold text-amber-900">Partial translation</div>
          <p className="mt-1 text-xs text-amber-900">{partial.headline}</p>
          <ul className="mt-2 max-h-40 space-y-0.5 overflow-auto font-mono text-[11px] text-amber-900">
            {partial.rows.map((r) => (
              <li key={r}>{r}</li>
            ))}
            {partial.more > 0 && <li>… and {partial.more} more</li>}
          </ul>
        </div>
      )}

      {notices.length > 0 && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
          <div className="text-sm font-semibold text-amber-900">Input file notes</div>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-amber-900">
            {notices.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3">
          <div className="text-sm font-semibold text-red-800">Error</div>
          <pre className="mt-2 whitespace-pre-wrap text-xs text-red-700">
            {error}
          </pre>
        </div>
      )}
    </div>
  );
}
