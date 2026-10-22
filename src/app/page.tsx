"use client";

import React, { useMemo, useRef, useState } from "react";
import UploadCard from "@/components/UploadCard";
import SettingsPanel from "@/components/SettingsPanel";
import TranslatePanel from "@/components/TranslatePanel";
import PreviewHeader from "@/components/PreviewHeader";
import PreviewPane from "@/components/PreviewPane";
import { downloadTextAsFile } from "@/lib/download";
import { errorMessage } from "@/lib/errors";
import { describeParseReport, describePartial, type PartialSummary } from "@/lib/translation/report";
import { RunControl } from "@/lib/translation/run-control";
import { readTranslationStream } from "@/lib/translation/stream-client";
import type { Settings } from "@/lib/types";

export default function Home() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [notices, setNotices] = useState<string[]>([]);
  const [partial, setPartial] = useState<PartialSummary | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const runs = useRef<RunControl | null>(null);

  const [settings, setSettings] = useState<Settings>({
    tone: "Neutral",
    preserveBreaks: true,
    maxChars: 42,
    glossary: "",
    removeSoundEffects: true,
  });

  const [search, setSearch] = useState("");
  const [previewEn, setPreviewEn] = useState<string>("");
  const [previewHe, setPreviewHe] = useState<string>("");
  const [translatedSrt, setTranslatedSrt] = useState<string>("");

  const canTranslate = !!file && !busy;

  const filteredPreview = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return { en: previewEn, he: previewHe };

    const enLines = previewEn.split("\n");
    const heLines = previewHe.split("\n");
    const outEn: string[] = [];
    const outHe: string[] = [];

    for (let i = 0; i < Math.max(enLines.length, heLines.length); i++) {
      const e = enLines[i] ?? "";
      const h = heLines[i] ?? "";
      if (e.toLowerCase().includes(q) || h.toLowerCase().includes(q)) {
        outEn.push(e);
        outHe.push(h);
      }
    }
    return { en: outEn.join("\n"), he: outHe.join("\n") };
  }, [previewEn, previewHe, search]);

  function onPickFileClick() {
    fileInputRef.current?.click();
  }

  function onFileSelected(f: File | null) {
    runs.current?.cancel();
    setBusy(false);
    setCancelled(false);
    setStatus(null);
    setError(null);
    setNotices([]);
    setPartial(null);
    setProgress(0);
    setPreviewEn("");
    setPreviewHe("");
    setTranslatedSrt("");
    setFile(f);

    if (f) {
      f.text()
        .then((t) => setPreviewEn(t))
        .catch(() => setPreviewEn(""));
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    const f = e.dataTransfer.files?.[0] ?? null;
    if (f && !f.name.toLowerCase().endsWith(".srt")) {
      setError("Please upload a .srt file.");
      return;
    }
    onFileSelected(f);
  }

  async function onTranslate() {
    if (!file) return;

    runs.current ??= new RunControl();
    const { id, signal } = runs.current.start();
    // False once this run was cancelled or replaced: its results are discarded.
    const isCurrent = () => runs.current?.isCurrent(id) ?? false;

    setBusy(true);
    setCancelled(false);
    setError(null);
    setNotices([]);
    setPartial(null);
    setStatus(null);
    setPreviewHe("");
    setTranslatedSrt("");
    setProgress(5);

    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("tone", settings.tone);
      fd.append("preserveBreaks", String(settings.preserveBreaks));
      fd.append("maxChars", String(settings.maxChars));
      fd.append("glossary", settings.glossary);
      fd.append("removeSoundEffects", String(settings.removeSoundEffects));

      const res = await fetch("/api/translate", {
        method: "POST",
        body: fd,
        signal,
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Request failed (${res.status})`);
      }

      // Handle streaming response
      const result = await readTranslationStream(
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

      setPreviewHe(result.content);
      setTranslatedSrt(result.content);
      setNotices(result.report ? describeParseReport(result.report.parse) : []);
      setPartial(result.partial && result.report ? describePartial(result.report) : null);
    } catch (err) {
      if (!isCurrent()) return;
      setError(errorMessage(err));
      setProgress(0);
    } finally {
      if (isCurrent()) {
        setStatus(null);
        setBusy(false);
      }
    }
  }

  // Stops the server job and discards everything from this run, even a
  // result that is already arriving.
  function onCancel() {
    runs.current?.cancel();
    setBusy(false);
    setProgress(0);
    setStatus(null);
    setError(null);
    setNotices([]);
    setPartial(null);
    setPreviewHe("");
    setTranslatedSrt("");
    setCancelled(true);
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white text-slate-900">
      <header className="mx-auto max-w-5xl px-4 pt-10 pb-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">
            HebraAI Subtitles
          </h1>
          <p className="text-slate-600">
            Upload a subtitle file, translate to Hebrew, review quickly and
            download - Simple.
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 pb-14">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
          <section className="lg:col-span-2">
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 p-5">
                <h2 className="text-lg font-semibold">Translate</h2>
                <p className="mt-1 text-sm text-slate-600">
                  3 steps: upload → configure → translate.
                </p>
              </div>

              <div className="p-5">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold text-slate-800">
                    1) Upload
                  </div>
                  <span className="text-xs text-slate-500">.srt only</span>
                </div>

                <UploadCard
                  file={file}
                  fileInputRef={fileInputRef}
                  onPickFileClick={onPickFileClick}
                  onFileSelected={onFileSelected}
                  onDrop={onDrop}
                />

                <SettingsPanel settings={settings} onChange={setSettings} />

                <TranslatePanel
                  canTranslate={canTranslate}
                  busy={busy}
                  progress={progress}
                  error={error}
                  notices={notices}
                  status={status}
                  cancelled={cancelled}
                  partial={partial}
                  onTranslate={onTranslate}
                  onCancel={onCancel}
                />
              </div>
            </div>

            <div className="mt-4 text-xs text-slate-500">
              Runs on localhost; your OpenAI key stays on the server.
            </div>
          </section>

          <section className="lg:col-span-3">
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <PreviewHeader
                search={search}
                setSearch={setSearch}
                canCopy={!!previewHe}
                onCopy={() => navigator.clipboard.writeText(previewHe || "")}
                canDownload={!!translatedSrt}
                downloadLabel={partial ? "Download Partial SRT" : "Download SRT"}
                onDownload={() =>
                  downloadTextAsFile(translatedSrt, partial ? "translated.he.PARTIAL.srt" : "translated.he.srt")
                }
              />

              <PreviewPane
                enText={filteredPreview.en}
                heText={filteredPreview.he}
              />
            </div>

            <div className="mt-4 flex flex-col gap-2 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
              <span>Fast UI, minimal dependencies, designed for large files.</span>
              <span>Single-user mode.</span>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
