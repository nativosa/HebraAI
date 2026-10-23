import React, { useId, useRef, useState } from "react";
import { Card, linkButton } from "./ui";

type Props = {
  file: File | null;
  // Cues found in the selected file (parsed in the browser), null while reading.
  cueCount: number | null;
  onFile: (file: File | null) => void;
  // A dropped file that is not .srt.
  onReject: (message: string) => void;
  disabled?: boolean;
};

const kb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024)).toLocaleString("en-US")} KB`;

export default function UploadCard({ file, cueCount, onFile, onReject, disabled }: Props) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const input = (
    <input
      id={inputId}
      ref={inputRef}
      // With a file selected, the Replace button opens the picker.
      tabIndex={file ? -1 : undefined}
      type="file"
      accept=".srt"
      disabled={disabled}
      className="peer sr-only"
      onChange={(e) => {
        const f = e.target.files?.[0] ?? null;
        e.target.value = ""; // choosing the same file again fires change again
        if (f) onFile(f);
      }}
    />
  );

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (disabled) return;
    const f = e.dataTransfer.files?.[0];
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".srt")) onReject("Please choose a .srt subtitle file.");
    else onFile(f);
  };
  const dragProps = {
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      if (!disabled) setDragging(true);
    },
    onDragLeave: () => setDragging(false),
    onDrop,
  };

  if (file) {
    return (
      <Card
        title="File"
        action={
          <button type="button" className={linkButton} disabled={disabled} onClick={() => inputRef.current?.click()}>
            Replace
          </button>
        }
        {...dragProps}
        className={dragging ? "ring-3 ring-ring" : ""}
      >
        {input}
        <div className="flex items-center gap-3">
          <div className="grid h-9.5 w-9.5 flex-none place-items-center rounded-lg bg-accent-soft text-[10.5px] font-semibold tracking-wide text-accent-fg">
            SRT
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium" data-file-name>
              {file.name}
            </div>
            <div className="text-[12.5px] text-muted">
              {kb(file.size)}
              {cueCount !== null && ` · ${cueCount.toLocaleString("en-US")} cue${cueCount === 1 ? "" : "s"}`}
            </div>
          </div>
          <button type="button" className={`${linkButton} text-muted`} disabled={disabled} onClick={() => onFile(null)}>
            Remove
          </button>
        </div>
      </Card>
    );
  }

  return (
    <Card title="File">
      {input}
      <label
        htmlFor={inputId}
        {...dragProps}
        className={`flex cursor-pointer flex-col items-center gap-1 rounded-lg border border-dashed px-4 py-6 text-center transition-colors peer-focus-visible:ring-3 peer-focus-visible:ring-ring ${
          dragging ? "border-accent bg-accent-soft" : "border-line-strong bg-surface-2 hover:border-accent"
        }`}
      >
        <span className="text-[13.5px] font-medium text-fg">Drop an .srt file here or click to choose</span>
        <span className="text-xs text-muted">English subtitles · processed on this computer&apos;s server</span>
      </label>
    </Card>
  );
}
