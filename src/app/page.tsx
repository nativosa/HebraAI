"use client";

import React, { useEffect, useRef, useState, useSyncExternalStore } from "react";
import CharacterReview, { type CharacterRow } from "@/components/CharacterReview";
import ConfirmDialog from "@/components/ConfirmDialog";
import CueReview, { cueLabel } from "@/components/CueReview";
import SettingsPanel from "@/components/SettingsPanel";
import ThemeToggle, { useAppliedTheme } from "@/components/ThemeToggle";
import TranslatePanel, { type Outcome } from "@/components/TranslatePanel";
import UploadCard from "@/components/UploadCard";
import { downloadTextAsFile } from "@/lib/download";
import { errorMessage } from "@/lib/errors";
import { buildExport } from "@/lib/review/export";
import { exportName } from "@/lib/review/filename";
import { updatePrefs, usePrefs } from "@/lib/review/prefs-store";
import { buildRows, soundEffectIds, type RowFilter } from "@/lib/review/rows";
import { unsavedWarning } from "@/lib/review/unsaved";
import { parseSrt, type Cue } from "@/lib/srt/parse";
import type { CharactersResult } from "@/lib/translation/characters";
import { parseGlossary } from "@/lib/translation/options";
import { describeGlossary, describeParseReport, describePartial, describeUsage } from "@/lib/translation/report";
import { RunControl } from "@/lib/translation/run-control";
import { readTranslationStream, type TranslationResult } from "@/lib/translation/stream-client";
import type { Settings } from "@/lib/types";

// The last translation, with the setting the server's filter ran with.
type Result = TranslationResult & { removeSoundEffects: boolean };

const DESKTOP = "(min-width: 1024px)";
const subscribeDesktop = (cb: () => void) => {
  const media = window.matchMedia(DESKTOP);
  media.addEventListener("change", cb);
  return () => media.removeEventListener("change", cb);
};

export default function Home() {
  const prefs = usePrefs();
  useAppliedTheme(prefs.theme);
  const desktop = useSyncExternalStore(subscribeDesktop, () => window.matchMedia(DESKTOP).matches, () => true);

  // Story notes describe one film and are never stored.
  const [notes, setNotes] = useState("");
  const settings: Settings = { ...prefs.settings, notes };

  const [file, setFile] = useState<File | null>(null);
  const [sourceCues, setSourceCues] = useState<Cue[] | null>(null);
  const fileToken = useRef(0);

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const runs = useRef<RunControl | null>(null);

  const [result, setResult] = useState<Result | null>(null);
  const [edits, setEdits] = useState<ReadonlyMap<number, string>>(new Map());
  // The result with its current edits was downloaded or copied.
  const [exported, setExported] = useState(false);

  const [filter, setFilter] = useState<RowFilter>("all");
  const [query, setQuery] = useState("");
  const [settingsOpen, setSettingsOpen] = useState<boolean | null>(null);

  // Context mode: character sheet from the optional analysis, edited by the user.
  const [characters, setCharacters] = useState<CharacterRow[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analysisSummary, setAnalysisSummary] = useState<string | null>(null);
  const analysis = useRef<AbortController | null>(null);

  // A pending action waiting for "discard unsaved work?" confirmation.
  const [pending, setPending] = useState<{ message: string; label: string; run: () => void } | null>(null);

  const warning = unsavedWarning({ hasResult: !!result, hasEdits: edits.size > 0, exported });

  useEffect(() => {
    if (!warning) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [warning]);

  const guarded = (label: string, run: () => void) => {
    if (warning) setPending({ message: warning, label, run });
    else run();
  };

  const rows = buildRows(
    sourceCues ?? [],
    result
      ? {
          cues: result.cues ?? [],
          untranslated: result.report?.untranslated ?? [],
          soundEffectIds: soundEffectIds(
            sourceCues ?? [],
            result.removeSoundEffects,
            result.report?.removedSoundEffectCues ?? -1
          ),
        }
      : undefined
  );
  const cueLabels = new Map(rows.map((r) => [r.id, cueLabel(r)]));
  const glossaryEntries = parseGlossary(settings.glossary).entries.length;

  function clearResult() {
    setResult(null);
    setEdits(new Map());
    setExported(false);
    setError(null);
    setCancelled(false);
    setProgress(0);
    setFilter("all");
  }

  function selectFile(f: File | null) {
    runs.current?.cancel();
    setBusy(false);
    setStatus(null);
    setStartedAt(null);
    clearResult();
    cancelAnalysis();
    setCharacters([]);
    setAnalysisError(null);
    setAnalysisSummary(null);
    setQuery("");
    setFile(f);
    setSourceCues(null);
    const token = ++fileToken.current;
    f?.text()
      .then((t) => fileToken.current === token && setSourceCues(parseSrt(t).cues))
      .catch(() => fileToken.current === token && setSourceCues([]));
  }

  async function translate() {
    if (!file) return;

    runs.current ??= new RunControl();
    const { id, signal } = runs.current.start();
    // False once this run was cancelled or replaced: its results are discarded.
    const isCurrent = () => runs.current?.isCurrent(id) ?? false;
    const runSettings = settings;

    clearResult();
    setBusy(true);
    setStatus(null);
    setStartedAt(Date.now());
    setProgress(5);

    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("tone", runSettings.tone);
      fd.append("preserveBreaks", String(runSettings.preserveBreaks));
      fd.append("maxChars", String(runSettings.maxChars));
      fd.append("glossary", runSettings.glossary);
      fd.append("removeSoundEffects", String(runSettings.removeSoundEffects));
      if (runSettings.mode === "context") {
        fd.append("mode", "context");
        fd.append("notes", runSettings.notes);
        const sheet = characters
          .filter((c) => c.name.trim())
          .map(({ name, hebrewName, aliases, gender }) => ({ name, hebrewName, aliases, gender }));
        fd.append("characters", JSON.stringify(sheet));
      }

      const res = await fetch("/api/translate", { method: "POST", body: fd, signal });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Request failed (${res.status})`);
      }

      const translation = await readTranslationStream(
        res,
        {
          onProgress: (p) => {
            if (!isCurrent()) return;
            setProgress(p);
            setStatus(null);
          },
          onRetry: (r) => {
            if (!isCurrent()) return;
            setStatus(
              `Temporary problem (${r.reason}) on chunk ${r.chunk}. Retrying in ${Math.ceil(r.delayMs / 1000)} s (retry ${r.attempt})…`
            );
          },
        },
        signal
      );
      if (!isCurrent()) return;
      setResult({ ...translation, removeSoundEffects: runSettings.removeSoundEffects });
    } catch (err) {
      if (!isCurrent()) return;
      setError(errorMessage(err));
      setProgress(0);
    } finally {
      if (isCurrent()) {
        setStatus(null);
        setBusy(false);
        setStartedAt(null);
      }
    }
  }

  // Stops the server job and discards everything from this run, even a
  // result that is already arriving.
  function cancelTranslation() {
    runs.current?.cancel();
    setBusy(false);
    setStatus(null);
    setStartedAt(null);
    clearResult();
    setCancelled(true);
  }

  async function analyze() {
    if (!file) return;
    cancelAnalysis();
    const controller = new AbortController();
    analysis.current = controller;
    setAnalyzing(true);
    setAnalysisError(null);
    setAnalysisSummary(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("notes", notes);
      const res = await fetch("/api/characters", { method: "POST", body: fd, signal: controller.signal });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
      if (analysis.current !== controller) return;
      const found = body as CharactersResult;
      setCharacters(found.characters.map((c, i) => ({ ...c, key: i + 1 })));
      setAnalysisSummary(
        `${found.characters.length} character${found.characters.length === 1 ? "" : "s"} found` +
          (found.analyzedCues < found.totalCues ? ` (first ${found.analyzedCues} of ${found.totalCues} cues analysed)` : "") +
          ` · ${found.requests} request${found.requests === 1 ? "" : "s"} · ${found.usage.inputTokens.toLocaleString("en-US")} input / ` +
          `${found.usage.outputTokens.toLocaleString("en-US")} output tokens` +
          (found.estimatedCostUsd === undefined ? "" : ` · ~$${found.estimatedCostUsd.toFixed(4)} (estimate)`)
      );
    } catch (err) {
      if (analysis.current !== controller) return;
      setAnalysisError(errorMessage(err));
    } finally {
      if (analysis.current === controller) {
        analysis.current = null;
        setAnalyzing(false);
      }
    }
  }

  // Aborts the analysis request; nothing from it is kept.
  function cancelAnalysis() {
    analysis.current?.abort();
    analysis.current = null;
    setAnalyzing(false);
  }

  function editCue(id: number, text: string | null) {
    setEdits((prev) => {
      const next = new Map(prev);
      if (text === null) next.delete(id);
      else next.set(id, text);
      return next;
    });
    setExported(false);
  }

  // The SRT to download or copy: every result cue with the edits applied.
  const exportText = () => (result?.cues ? buildExport(result.cues, edits, prefs.export) : (result?.content ?? ""));
  const fileExportName = exportName(file?.name, !!result?.partial);

  function download() {
    if (!result) return;
    downloadTextAsFile(exportText(), fileExportName);
    setExported(true);
  }

  async function copy(): Promise<boolean> {
    if (!result) return false;
    try {
      await navigator.clipboard.writeText(exportText());
      setExported(true);
      return true;
    } catch {
      return false;
    }
  }

  function showCue(id: number) {
    setFilter("all");
    setQuery("");
    setTimeout(() => {
      document.querySelector(`[data-cue-id="${id}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 0);
  }

  const report = result?.report;
  const outcome: Outcome = cancelled
    ? { kind: "cancelled" }
    : !result
      ? { kind: "idle" }
      : result.partial && report
        ? { kind: "partial", headline: describePartial(report).headline }
        : { kind: "complete", translated: report?.translated ?? result.cues?.length ?? 0, removed: report?.removedSoundEffectCues ?? 0 };

  const collapsed = prefs.sidebarCollapsed;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-surface px-4 lg:px-5">
        <div className="flex items-center gap-2.5 text-[15px] font-semibold tracking-tight">
          <span aria-hidden className="text-he grid h-7 w-7 place-items-center rounded-lg bg-accent text-[15px] text-on-accent">
            ע
          </span>
          HebraAI <span className="hidden text-[13px] font-normal text-muted sm:inline">Subtitles</span>
        </div>
        <span className="flex-1" />
        <span className="hidden items-center gap-1.5 text-xs text-muted md:flex">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-ok" />
          Local · API key stays on the server
        </span>
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-controls="workflow"
          onClick={() => updatePrefs((p) => ({ ...p, sidebarCollapsed: !p.sidebarCollapsed }))}
          className="hidden h-8 items-center rounded-lg border border-line px-2.5 text-[12.5px] text-fg-2 hover:bg-surface-2 focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none lg:inline-flex"
        >
          {collapsed ? "Show panel" : "Hide panel"}
        </button>
        <ThemeToggle theme={prefs.theme} onChange={(theme) => updatePrefs((p) => ({ ...p, theme }))} />
      </header>

      <div
        className={`mx-auto grid max-w-[1600px] items-start gap-3 p-3 lg:gap-5 lg:p-5 ${
          collapsed ? "lg:grid-cols-[minmax(0,1fr)]" : "lg:grid-cols-[340px_minmax(0,1fr)]"
        }`}
      >
        <aside
          id="workflow"
          aria-label="Workflow"
          className={`flex min-w-0 flex-col gap-3 lg:sticky lg:top-[76px] lg:max-h-[calc(100vh-96px)] lg:gap-3.5 lg:overflow-y-auto lg:[scrollbar-width:thin] ${
            collapsed ? "lg:hidden" : ""
          }`}
        >
          <UploadCard
            file={file}
            cueCount={sourceCues?.length ?? null}
            onFile={(f) => guarded(f ? "Open the new file" : "Remove the file", () => selectFile(f))}
            onReject={setError}
          />
          <SettingsPanel
            settings={settings}
            onChange={(patch) => updatePrefs((p) => ({ ...p, settings: { ...p.settings, ...patch } }))}
            glossaryEntries={glossaryEntries}
            open={settingsOpen ?? desktop}
            onToggle={() => setSettingsOpen(!(settingsOpen ?? desktop))}
          />
          {settings.mode === "context" && (
            <CharacterReview
              notes={notes}
              onNotes={setNotes}
              rows={characters}
              onChange={setCharacters}
              canAnalyze={!!file && !busy}
              analyzing={analyzing}
              error={analysisError}
              summary={analysisSummary}
              onAnalyze={analyze}
              onCancel={cancelAnalysis}
              cueLabel={(id) => cueLabels.get(id) ?? `cue ${id}`}
              onShowCue={showCue}
            />
          )}
          <TranslatePanel
            canTranslate={!!file && !busy && !analyzing}
            hasResult={!!result}
            busy={busy}
            progress={progress}
            startedAt={startedAt}
            status={status}
            outcome={outcome}
            error={error}
            notices={report ? [...describeParseReport(report.parse), ...describeGlossary(report.glossary)] : []}
            usage={!busy && report ? describeUsage(report) : null}
            onTranslate={() => guarded("Translate again", translate)}
            onCancel={cancelTranslation}
            onShowUntranslated={() => setFilter("untranslated")}
          />
        </aside>

        <CueReview
          fileName={file?.name ?? null}
          rows={rows}
          edits={edits}
          onEdit={editCue}
          maxChars={settings.maxChars}
          hasResult={!!result}
          partial={!!result?.partial}
          busy={busy}
          filter={filter}
          onFilter={setFilter}
          query={query}
          onQuery={setQuery}
          exportName={fileExportName}
          exportOptions={prefs.export}
          onExportOptions={(options) => updatePrefs((p) => ({ ...p, export: options }))}
          exported={exported}
          onDownload={download}
          onCopy={copy}
        />
      </div>

      <ConfirmDialog
        message={pending?.message ?? null}
        confirmLabel={pending?.label ?? ""}
        onConfirm={() => {
          const run = pending?.run;
          setPending(null);
          run?.();
        }}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}
