import React from "react";

type Props = {
  file: File | null;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onPickFileClick: () => void;
  onFileSelected: (f: File | null) => void;
  onDrop: (e: React.DragEvent) => void;
};

export default function UploadCard({
  file,
  fileInputRef,
  onPickFileClick,
  onFileSelected,
  onDrop,
}: Props) {
  return (
    <div
      className="mt-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4"
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 h-9 w-9 rounded-lg bg-white border border-slate-200 flex items-center justify-center">
          <span className="text-slate-500 text-sm">SRT</span>
        </div>

        <div className="flex-1">
          <div className="text-sm text-slate-800">
            Drag & drop your file here, or{" "}
            <button
              type="button"
              onClick={onPickFileClick}
              className="font-semibold text-slate-900 underline underline-offset-2"
            >
              browse
            </button>
          </div>

          <div className="mt-1 text-xs text-slate-600">
            Large files are fine. Processing happens server-side.
          </div>

          <div className="mt-3 flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".srt"
              className="hidden"
              onChange={(e) => onFileSelected(e.target.files?.[0] ?? null)}
            />

            <div className="text-xs text-slate-700">
              {file ? (
                <>
                  <span className="font-semibold">{file.name}</span>{" "}
                  <span className="text-slate-500">
                    ({Math.round(file.size / 1024)} KB)
                  </span>
                </>
              ) : (
                <span className="text-slate-500">No file selected</span>
              )}
            </div>

            {file && (
              <button
                type="button"
                className="ml-auto text-xs font-semibold text-slate-700 hover:text-slate-900"
                onClick={() => onFileSelected(null)}
              >
                Remove
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
