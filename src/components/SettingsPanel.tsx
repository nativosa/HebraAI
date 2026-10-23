import React from "react";
import type { Mode, Settings, Tone } from "@/lib/types";

type Props = {
  settings: Settings;
  onChange: (next: Settings) => void;
  // Shown under the mode setting (the character review in context mode).
  children?: React.ReactNode;
};

export default function SettingsPanel({ settings, onChange, children }: Props) {
  const setTone = (tone: Tone) => onChange({ ...settings, tone });
  const setPreserveBreaks = (preserveBreaks: boolean) =>
    onChange({ ...settings, preserveBreaks });
  const setMaxChars = (maxChars: number) => onChange({ ...settings, maxChars });
  const setGlossary = (glossary: string) => onChange({ ...settings, glossary });

  return (
    <div className="mt-6">
      <div className="text-sm font-semibold text-slate-800">2) Settings</div>

      <div className="mt-3 grid grid-cols-1 gap-3">
        <div className="rounded-xl border border-slate-200 p-3">
          <label className="text-xs font-semibold text-slate-700">Translation mode</label>
          <select
            aria-label="Translation mode"
            value={settings.mode}
            onChange={(e) => onChange({ ...settings, mode: e.target.value as Mode })}
            className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
          >
            <option value="classic">Classic</option>
            <option value="context">Context-aware (Hebrew gender)</option>
          </select>
          <p className="mt-2 text-xs text-slate-500">
            Context-aware sends neighbouring lines, Hebrew gender rules and an optional character list with
            each request (somewhat more tokens).
          </p>
          {settings.mode === "context" && (
            <>
              <label className="mt-3 block text-xs font-semibold text-slate-700">Story notes (optional)</label>
              <textarea
                aria-label="Story notes"
                value={settings.notes}
                maxLength={4000}
                onChange={(e) => onChange({ ...settings, notes: e.target.value })}
                placeholder="e.g. Dana and Mia are sisters; Alex is a man."
                className="mt-2 h-16 w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              />
            </>
          )}
          {children}
        </div>

        <div className="rounded-xl border border-slate-200 p-3">
          <label className="text-xs font-semibold text-slate-700">Tone</label>
          <select
            value={settings.tone}
            onChange={(e) => setTone(e.target.value as Tone)}
            className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
          >
            <option>Neutral</option>
            <option>Informal</option>
            <option>Formal</option>
          </select>
          <p className="mt-2 text-xs text-slate-500">
            Controls Hebrew phrasing style for dialogue.
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 p-3">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-slate-700">
              Preserve line breaks
            </label>
            <input
              type="checkbox"
              checked={settings.preserveBreaks}
              onChange={(e) => setPreserveBreaks(e.target.checked)}
              className="h-4 w-4"
            />
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Keeps subtitle readability similar to the original.
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 p-3">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-slate-700">
              Remove sound-effect lines
            </label>
            <input
              type="checkbox"
              checked={settings.removeSoundEffects}
              onChange={(e) =>
                onChange({ ...settings, removeSoundEffects: e.target.checked })
              }
              className="h-4 w-4"
            />
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Removes lines like [music], (laughs), ♪ singing ♪ before
            translation.
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 p-3">
          <label className="text-xs font-semibold text-slate-700">
            Max characters per line
          </label>
          <input
            type="number"
            min={20}
            max={80}
            value={settings.maxChars}
            onChange={(e) => setMaxChars(Number(e.target.value))}
            className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
          />
          <p className="mt-2 text-xs text-slate-500">
            Helps keep captions comfortable on screen.
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 p-3">
          <label className="text-xs font-semibold text-slate-700">
            Glossary (optional)
          </label>
          <textarea
            value={settings.glossary}
            onChange={(e) => setGlossary(e.target.value)}
            placeholder={`One per line, e.g.\nJohn = ג׳ון\nFBI = FBI`}
            className="mt-2 h-24 w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
          />
          <p className="mt-2 text-xs text-slate-500">
            Forces consistent translation of names/terms.
          </p>
        </div>
      </div>
    </div>
  );
}
