import React, { useEffect, useRef, useState } from "react";
import { checkEdit, type ExportOptions } from "@/lib/review/export";
import { filterRows, rowCounts, type Edits, type ReviewRow, type RowFilter } from "@/lib/review/rows";
import { FAILURE_LABELS } from "@/lib/translation/report";
import { Badge, Button, inputClass, linkButton } from "./ui";

type Props = {
  fileName: string | null;
  rows: ReviewRow[];
  edits: Edits;
  // null reverts the cue to the model's text.
  onEdit: (id: number, text: string | null) => void;
  maxChars: number;
  hasResult: boolean;
  partial: boolean;
  busy: boolean;
  filter: RowFilter;
  onFilter: (filter: RowFilter) => void;
  query: string;
  onQuery: (query: string) => void;
  // Export
  exportName: string;
  exportOptions: ExportOptions;
  onExportOptions: (options: ExportOptions) => void;
  exported: boolean;
  onDownload: () => void;
  onCopy: () => Promise<boolean>;
};

export const cueLabel = (row: { id: number; number: number | null }) => (row.number === null ? `cue ${row.id}` : `#${row.number}`);

// Wraps case-insensitive matches of `query` in <mark>.
function highlight(text: string, query: string): React.ReactNode {
  const q = query.trim().toLowerCase();
  const lower = text.toLowerCase();
  if (!q || lower.length !== text.length) return text;
  const parts: React.ReactNode[] = [];
  let at = 0;
  for (let i = lower.indexOf(q); i >= 0; i = lower.indexOf(q, i + q.length)) {
    parts.push(text.slice(at, i), <mark key={i} className="rounded-sm bg-mark px-px text-inherit">{text.slice(i, i + q.length)}</mark>);
    at = i + q.length;
  }
  parts.push(text.slice(at));
  return parts;
}

type Editing = { id: number; draft: string; initial: string; error: string | null };

export default function CueReview(props: Props) {
  const { rows, edits, onEdit, maxChars, hasResult, partial, busy, filter, onFilter, query, onQuery } = props;
  const [editing, setEditing] = useState<Editing | null>(null);
  const [navIndex, setNavIndex] = useState(-1);
  // Row whose edit button gets the focus back after editing.
  const returnFocus = useRef<number | null>(null);

  const shown = filterRows(rows, filter, query, edits);
  const counts = rowCounts(rows, edits);
  const navigating = filter !== "all" || query.trim() !== "";

  useEffect(() => {
    if (editing || returnFocus.current === null) return;
    const button = document.querySelector<HTMLElement>(`[data-cue-id="${returnFocus.current}"] [data-edit]`);
    returnFocus.current = null;
    button?.focus({ preventScroll: true });
  }, [editing]);

  // Saves the open editor. Returns false (and shows why) if the text is invalid.
  const commit = (current: Editing): boolean => {
    if (current.draft === current.initial) return true;
    const check = checkEdit(current.draft);
    if (check.kind === "invalid") {
      setEditing({ ...current, error: check.message });
      return false;
    }
    const row = rows.find((r) => r.id === current.id);
    const text = check.kind === "ok" && check.text !== row?.output ? check.text : null;
    onEdit(current.id, text);
    return true;
  };

  const open = (row: ReviewRow) => {
    if (editing && !commit(editing)) return;
    // Untranslated cues start empty (the kept English is shown as a placeholder).
    const initial = edits.get(row.id) ?? (row.status === "untranslated" ? "" : (row.output ?? ""));
    setEditing({ id: row.id, draft: initial, initial, error: null });
  };
  const close = (save: boolean) => {
    if (!editing) return;
    if (save && !commit(editing)) return;
    returnFocus.current = editing.id;
    setEditing(null);
  };

  const go = (step: number) => {
    if (!shown.length) return;
    const next = (navIndex + step + shown.length) % shown.length;
    setNavIndex(next);
    document
      .querySelector(`[data-cue-id="${shown[next].id}"]`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  };
  const setFilter = (f: RowFilter) => {
    setNavIndex(-1);
    onFilter(f);
  };

  const chips: { value: RowFilter; label: string; count: number }[] = [
    { value: "all", label: "All", count: counts.all },
    { value: "untranslated", label: "Untranslated", count: counts.untranslated },
    { value: "edited", label: "Edited", count: counts.edited },
    { value: "removed", label: "Removed", count: counts.removed },
  ];

  const canExport = hasResult && !busy;

  return (
    <section aria-label="Subtitle review" className="min-w-0 rounded-xl border border-line bg-surface shadow-sm">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3.5">
        <div className="min-w-0 flex-1">
          <h1 className="text-base font-semibold tracking-tight">Review</h1>
          <p className="truncate text-[12.5px] text-muted" data-review-summary>
            {props.fileName ? `${props.fileName} · ${rows.length.toLocaleString("en-US")} cues` : "No file"}
            {busy && " · Hebrew appears when the translation finishes"}
            {!busy && counts.edited > 0 && ` · ${counts.edited} edited`}
            {!busy && hasResult && !props.exported && " · not exported yet"}
          </p>
        </div>
        <ExportActions {...props} canExport={canExport} className="hidden lg:flex" />
      </div>

      <div className="sticky top-14 z-10 flex flex-wrap items-center gap-2.5 border-b border-line bg-surface px-4 py-2.5">
        <label className="relative w-full sm:w-64">
          <span className="sr-only">Search subtitles</span>
          <svg aria-hidden width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="pointer-events-none absolute top-2.5 left-2.5 text-faint">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setNavIndex(-1);
              onQuery(e.target.value);
            }}
            placeholder="Search English or Hebrew…"
            className={`${inputClass} h-8 pl-8`}
          />
        </label>
        <div role="group" aria-label="Filter" className="flex gap-1.5 overflow-x-auto [scrollbar-width:none]">
          {chips.map((c) => (
            <button
              key={c.value}
              type="button"
              aria-pressed={filter === c.value}
              data-filter={c.value}
              onClick={() => setFilter(c.value)}
              className={`inline-flex h-7.5 items-center gap-1.5 rounded-full border px-2.5 text-[12.5px] whitespace-nowrap focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none ${
                filter === c.value
                  ? "border-fg bg-fg text-bg"
                  : c.value === "untranslated" && c.count > 0
                    ? "border-warn-line bg-surface text-fg-2"
                    : "border-line bg-surface text-fg-2 hover:bg-surface-2"
              }`}
            >
              {c.label}
              <span className={`font-mono text-[11.5px] ${filter === c.value ? "opacity-70" : c.value === "untranslated" && c.count > 0 ? "text-warn" : "text-muted"}`}>
                {c.count.toLocaleString("en-US")}
              </span>
            </button>
          ))}
        </div>
        {navigating && (
          <div className="ml-auto flex items-center gap-1 text-[12.5px] text-muted" data-nav>
            <span aria-live="polite">
              {shown.length === 0
                ? "No matches"
                : navIndex >= 0
                  ? `${navIndex + 1} of ${shown.length}`
                  : `${shown.length.toLocaleString("en-US")} shown`}
            </span>
            <Button size="sm" variant="ghost" aria-label="Previous" disabled={!shown.length} onClick={() => go(-1)}>
              ‹
            </Button>
            <Button size="sm" variant="ghost" aria-label="Next" disabled={!shown.length} onClick={() => go(1)}>
              ›
            </Button>
          </div>
        )}
      </div>

      {partial && !busy && counts.untranslated > 0 && (
        <div className="mx-4 mt-3 flex flex-wrap items-center gap-2.5 rounded-lg border border-warn-line bg-warn-soft px-3 py-2 text-[13px] text-warn">
          <span className="flex-1">
            <b className="font-semibold">
              {counts.untranslated} cue{counts.untranslated === 1 ? " was" : "s were"} not translated
            </b>{" "}
            and {counts.untranslated === 1 ? "is" : "are"} kept in English. Edit them here or translate again.
          </span>
          {filter !== "untranslated" && (
            <Button size="sm" onClick={() => setFilter("untranslated")}>
              Show untranslated
            </Button>
          )}
        </div>
      )}

      {rows.length === 0 ? (
        <p className="px-4 py-16 text-center text-sm text-muted">
          {props.fileName ? "No subtitles found in this file." : "Choose an .srt file to see its subtitles here."}
        </p>
      ) : (
        <>
          <div className="hidden grid-cols-[112px_minmax(0,1fr)_minmax(0,1fr)] px-6 pt-2.5 pb-1.5 text-[11.5px] font-semibold tracking-wider text-muted uppercase md:grid">
            <div># · Time</div>
            <div className="px-2">English</div>
            <div className="text-he px-2 text-right" lang="he" dir="rtl">
              עברית
            </div>
          </div>
          <div className="px-2 pb-3 md:px-2" data-rows>
            {shown.map((row, i) => (
              <Row
                key={row.id}
                row={row}
                edit={edits.get(row.id)}
                editing={editing?.id === row.id ? editing : null}
                current={navigating && i === navIndex}
                query={query}
                maxChars={maxChars}
                editable={hasResult && !busy}
                onOpen={() => open(row)}
                onDraft={(draft) => setEditing((e) => (e ? { ...e, draft, error: null } : e))}
                onSave={() => close(true)}
                onCancel={() => close(false)}
                onRevert={() => onEdit(row.id, null)}
              />
            ))}
            {shown.length === 0 && <p className="px-4 py-10 text-center text-sm text-muted">No cues match.</p>}
          </div>
        </>
      )}

      <ExportActions
        {...props}
        canExport={canExport}
        compact
        className="sticky bottom-0 flex border-t border-line bg-surface px-3 py-2.5 lg:hidden"
      />
    </section>
  );
}

function ExportActions({
  canExport,
  exportName,
  exportOptions,
  onExportOptions,
  partial,
  onDownload,
  onCopy,
  compact = false,
  className = "",
}: Props & { canExport: boolean; compact?: boolean; className?: string }) {
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");
  const options = useRef<HTMLDetailsElement>(null);
  // The options popover closes on a click outside it or Esc.
  useEffect(() => {
    const close = (e: Event) => {
      const el = options.current;
      if (!el?.open) return;
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !el.contains(e.target as Node)) el.open = false;
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, []);
  useEffect(() => {
    if (copy === "idle") return;
    const timer = setTimeout(() => setCopy("idle"), 2500);
    return () => clearTimeout(timer);
  }, [copy]);

  return (
    <div className={`items-center gap-2 ${className}`}>
      <Button
        data-action="copy"
        disabled={!canExport}
        onClick={async () => setCopy((await onCopy()) ? "copied" : "failed")}
        className={compact ? "h-10.5" : ""}
      >
        {copy === "copied" ? "Copied" : copy === "failed" ? "Copy failed" : compact ? "Copy" : "Copy SRT"}
      </Button>
      <div className={`flex ${compact ? "flex-1" : ""}`}>
        <Button
          variant="primary"
          data-action="download"
          disabled={!canExport}
          onClick={onDownload}
          title={exportName}
          className={`rounded-r-none ${compact ? "h-10.5 flex-1" : ""}`}
        >
          <svg aria-hidden width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 20h14" />
          </svg>
          {partial ? "Download partial" : "Download"}
          {!compact && <span className="max-w-56 truncate font-normal opacity-80">{exportName}</span>}
        </Button>
        <details ref={options} className="relative" data-export-options>
          <summary
            aria-label="Export options"
            className={`flex h-full cursor-pointer list-none items-center rounded-r-lg border border-l-0 border-accent bg-accent px-2.5 text-on-accent focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none ${compact ? "h-10.5" : "h-9"}`}
          >
            <span aria-hidden className="text-xs">▾</span>
          </summary>
          <div
            className={`absolute right-0 z-20 w-64 rounded-lg border border-line bg-surface p-3 text-[13px] shadow-lg ${compact ? "bottom-full mb-2" : "top-full mt-2"}`}
          >
            <div className="mb-2 text-xs font-semibold tracking-wider text-muted uppercase">Export options</div>
            <label className="flex items-start gap-2 py-1">
              <input
                type="checkbox"
                checked={exportOptions.bom}
                onChange={(e) => onExportOptions({ ...exportOptions, bom: e.target.checked })}
                className="mt-0.5 accent-[var(--accent)]"
              />
              <span>
                Add UTF-8 BOM <span className="block text-xs text-muted">For older players that misread Hebrew.</span>
              </span>
            </label>
            <label className="flex items-start gap-2 py-1">
              <input
                type="checkbox"
                checked={exportOptions.renumber}
                onChange={(e) => onExportOptions({ ...exportOptions, renumber: e.target.checked })}
                className="mt-0.5 accent-[var(--accent)]"
              />
              <span>
                Renumber cues 1…N <span className="block text-xs text-muted">Off: keep the original numbers.</span>
              </span>
            </label>
            <p className="mt-2 border-t border-line pt-2 text-xs break-all text-muted">{exportName}</p>
          </div>
        </details>
      </div>
    </div>
  );
}

type RowProps = {
  row: ReviewRow;
  edit: string | undefined;
  editing: Editing | null;
  current: boolean;
  query: string;
  maxChars: number;
  editable: boolean;
  onOpen: () => void;
  onDraft: (draft: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onRevert: () => void;
};

function Row({ row, edit, editing, current, query, maxChars, editable, onOpen, onDraft, onSave, onCancel, onRevert }: RowProps) {
  const label = cueLabel(row);
  const edited = edit !== undefined;
  const warn = !edited && (row.status === "untranslated" || row.status === "missing");
  const muted = row.status === "removed";

  return (
    <div
      data-cue-id={row.id}
      data-status={row.status}
      data-edited={edited || undefined}
      className={`cue-row relative grid grid-cols-1 rounded-lg border-line md:grid-cols-[112px_minmax(0,1fr)_minmax(0,1fr)] max-md:mt-2.5 max-md:border md:[&+&]:border-t ${
        editing
          ? "bg-accent-soft shadow-[inset_0_0_0_1.5px_var(--accent)]"
          : warn
            ? "bg-warn-soft"
            : muted
              ? "bg-[repeating-linear-gradient(-45deg,transparent_0_8px,var(--surface-2)_8px_9px)]"
              : "md:hover:bg-surface-2"
      } ${current ? "outline-2 outline-accent" : ""}`}
    >
      {warn && <span aria-hidden className="absolute top-2 bottom-2 left-0 w-[3px] rounded bg-warn-bar" />}

      <div className="flex items-baseline justify-between gap-2 px-3 pt-2.5 md:block md:px-2 md:py-2.5">
        <div className={`font-mono text-[12.5px] font-medium ${muted ? "text-faint" : "text-fg-2"}`}>{label}</div>
        <div className="font-mono text-[11.5px] leading-normal text-muted tabular-nums md:mt-0.5" dir="ltr">
          <span>{row.start}</span>
          <span className="md:hidden"> → </span>
          <br className="max-md:hidden" />
          <span>{row.end}</span>
        </div>
      </div>

      <div
        lang="en"
        dir="ltr"
        className={`px-3 pt-1.5 pb-2 text-[14.5px] leading-relaxed whitespace-pre-line md:px-2 md:py-2.5 ${muted ? "text-faint" : "text-fg"}`}
      >
        {highlight(row.en, query)}
      </div>

      <div className="border-line px-3 pt-2 pb-3 max-md:border-t max-md:border-dashed md:border-l md:py-2.5 md:pr-2 md:pl-4">
        {editing ? (
          <Editor row={row} editing={editing} maxChars={maxChars} onDraft={onDraft} onSave={onSave} onCancel={onCancel} />
        ) : (
          <HebrewCell row={row} edit={edit} query={query} editable={editable} onOpen={onOpen} onRevert={onRevert} />
        )}
      </div>
    </div>
  );
}

function HebrewCell({
  row,
  edit,
  query,
  editable,
  onOpen,
  onRevert,
}: {
  row: ReviewRow;
  edit: string | undefined;
  query: string;
  editable: boolean;
  onOpen: () => void;
  onRevert: () => void;
}) {
  const label = cueLabel(row);
  if (row.status === "pending") {
    return (
      <span className="block text-right text-faint" aria-label="Not translated yet">
        —
      </span>
    );
  }
  if (row.status === "removed") {
    return <span className="block text-right text-[12.5px] text-faint">Sound effect · not exported</span>;
  }
  if (row.status === "missing") {
    return <Badge tone="warn">Missing from the result · not exported</Badge>;
  }

  const text = edit ?? row.output ?? "";
  const keptEnglish = edit === undefined && row.status === "untranslated";

  return (
    <div>
      <button
        type="button"
        data-edit
        disabled={!editable}
        onClick={onOpen}
        dir={keptEnglish ? "ltr" : "rtl"}
        lang={keptEnglish ? "en" : "he"}
        className={`block w-full rounded-md px-1 py-0.5 leading-relaxed whitespace-pre-line focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none enabled:cursor-text enabled:hover:bg-surface/60 disabled:cursor-default ${
          keptEnglish ? "text-left text-[14.5px] text-muted" : "text-he text-right text-base text-fg"
        }`}
      >
        <span className="sr-only">{`Edit ${label}: `}</span>
        {highlight(text, query)}
      </button>
      {keptEnglish && (
        <div className="mt-1 flex flex-wrap gap-1.5">
          <Badge tone="warn">Kept in English · {row.reason ? FAILURE_LABELS[row.reason] : "not translated"}</Badge>
          {editable && (
            <button type="button" onClick={onOpen} className={linkButton}>
              Translate manually
            </button>
          )}
        </div>
      )}
      {edit !== undefined && (
        <div className="mt-1 flex items-center justify-end gap-2">
          <Badge tone="accent">Edited</Badge>
          {editable && (
            <button type="button" onClick={onRevert} className={`${linkButton} text-muted`} aria-label={`Revert ${label}`}>
              Revert
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Editor({
  row,
  editing,
  maxChars,
  onDraft,
  onSave,
  onCancel,
}: {
  row: ReviewRow;
  editing: Editing;
  maxChars: number;
  onDraft: (draft: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  const lines = editing.draft.split(/\r\n?|\n/);
  const modelText = row.status === "untranslated" ? null : row.output;
  const errorId = `edit-error-${row.id}`;

  return (
    <div className="flex flex-col gap-2">
      <textarea
        ref={ref}
        dir="rtl"
        lang="he"
        aria-label={`Hebrew translation for ${cueLabel(row)}`}
        aria-invalid={!!editing.error}
        aria-describedby={editing.error ? errorId : undefined}
        value={editing.draft}
        placeholder={row.status === "untranslated" ? "Type the Hebrew translation" : undefined}
        rows={Math.max(2, lines.length)}
        onChange={(e) => onDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            onSave();
          }
        }}
        className="text-he w-full resize-y rounded-lg border border-accent bg-surface px-2.5 py-2 text-right text-base leading-relaxed text-fg ring-3 ring-ring outline-none"
      />
      {editing.error && (
        <p id={errorId} role="alert" className="text-[12.5px] text-danger">
          {editing.error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2" dir="ltr">
        <div className="flex gap-2 font-mono text-[11.5px] text-muted" aria-label="Characters per line">
          {lines.map((l, i) => (
            <span key={i} className={l.length > maxChars ? "font-semibold text-danger" : ""}>
              L{i + 1} {l.length}/{maxChars}
            </span>
          ))}
        </div>
        <span className="flex-1" />
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel <kbd className="font-mono text-[10.5px] opacity-70">Esc</kbd>
        </Button>
        <Button size="sm" variant="primary" onClick={onSave} data-action="save-edit">
          Save <kbd className="font-mono text-[10.5px] opacity-80">Ctrl+Enter</kbd>
        </Button>
      </div>
      {modelText && (
        <div className="text-xs text-muted">
          <div className="flex items-center justify-between">
            <span>Model output</span>
            {editing.draft !== modelText && (
              <button type="button" className={linkButton} onClick={() => onDraft(modelText)}>
                Use model text
              </button>
            )}
          </div>
          <div dir="rtl" lang="he" className="text-he mt-0.5 text-right text-[13.5px] whitespace-pre-line text-fg-2">
            {modelText}
          </div>
        </div>
      )}
    </div>
  );
}
