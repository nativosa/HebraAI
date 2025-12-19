import React from "react";

type Props = {
  search: string;
  setSearch: (v: string) => void;
  canCopy: boolean;
  onCopy: () => void;
  canDownload: boolean;
  onDownload: () => void;
};

export default function PreviewHeader({
  search,
  setSearch,
  canCopy,
  onCopy,
  canDownload,
  onDownload,
}: Props) {
  return (
    <div className="flex flex-col gap-3 border-b border-slate-200 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 className="text-lg font-semibold">Preview</h2>
        <p className="mt-1 text-sm text-slate-600">
          English on the left. Hebrew on the right (RTL).
        </p>
      </div>

      <div className="flex items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search…"
          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm sm:w-56"
        />

        <button
          type="button"
          onClick={onCopy}
          disabled={!canCopy}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 disabled:opacity-40"
        >
          Copy HE
        </button>

        <button
          type="button"
          disabled={!canDownload}
          onClick={onDownload}
          className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          Download SRT
        </button>
      </div>
    </div>
  );
}
