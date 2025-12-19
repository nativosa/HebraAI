import React from "react";

type Props = {
  canTranslate: boolean;
  busy: boolean;
  progress: number;
  error: string | null;
  onTranslate: () => void;
};

export default function TranslatePanel({
  canTranslate,
  busy,
  progress,
  error,
  onTranslate,
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

      <div className="mt-3">
        <div className="h-2 w-full rounded-full bg-slate-100">
          <div
            className="h-2 rounded-full bg-slate-900 transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="mt-2 text-xs text-slate-500">
          {busy
            ? "Working…"
            : progress === 100
            ? "Done. Review the preview, then click Download."
            : "Idle"}
        </div>
      </div>

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
