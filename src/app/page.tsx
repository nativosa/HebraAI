"use client";

import React, { useMemo, useRef, useState } from "react";
import UploadCard from "@/components/UploadCard";
import SettingsPanel from "@/components/SettingsPanel";
import TranslatePanel from "@/components/TranslatePanel";
import PreviewHeader from "@/components/PreviewHeader";
import PreviewPane from "@/components/PreviewPane";
import { downloadTextAsFile } from "@/lib/download";
import type { Settings } from "@/lib/types";

export default function Home() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);

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
    setError(null);
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

    setBusy(true);
    setError(null);
    setProgress(10);

    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("tone", settings.tone);
      fd.append("preserveBreaks", String(settings.preserveBreaks));
      fd.append("maxChars", String(settings.maxChars));
      fd.append("glossary", settings.glossary);
      fd.append("removeSoundEffects", String(settings.removeSoundEffects));

      setProgress(35);

      const res = await fetch("/api/translate", {
        method: "POST",
        body: fd,
      });

      setProgress(70);

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Request failed (${res.status})`);
      }

      const translatedText = await res.text();
      setPreviewHe(translatedText);
      setTranslatedSrt(translatedText);
      setProgress(100);
    } catch (err: any) {
      setError(err?.message ?? String(err));
      setProgress(0);
    } finally {
      setBusy(false);
    }
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
                  onTranslate={onTranslate}
                />
              </div>
            </div>

            <div className="mt-4 text-xs text-slate-500">
              Tip: if you plan to share this tool publicly, add a simple
              password gate to protect your API key.
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
                onDownload={() =>
                  downloadTextAsFile(translatedSrt, "translated.he.srt")
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
