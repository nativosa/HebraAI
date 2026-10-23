import React from "react";
import { GLOSSARY_MAX_CHARS } from "@/lib/translation/options";
import type { Mode, Settings, Tone } from "@/lib/types";
import { Card, Switch, inputClass } from "./ui";

type Props = {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  // Glossary entries recognised ("term = translation" lines).
  glossaryEntries: number;
  // Collapsed: a one-line summary with a button to open (mobile default).
  open: boolean;
  onToggle: () => void;
};

const MODES: { value: Mode; label: string }[] = [
  { value: "classic", label: "Classic" },
  { value: "context", label: "Context-aware" },
];

export function settingsSummary(s: Settings, glossaryEntries: number): string {
  return [
    s.mode === "context" ? "Context-aware" : "Classic",
    s.tone,
    `${s.maxChars} chars`,
    s.removeSoundEffects ? "sound effects removed" : null,
    glossaryEntries ? `glossary ${glossaryEntries}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export default function SettingsPanel({ settings, onChange, glossaryEntries, open, onToggle }: Props) {
  const toggle = (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls="translation-settings"
      className="rounded text-[12.5px] font-medium text-accent-fg hover:underline focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none"
    >
      {open ? "Hide" : "Edit"}
    </button>
  );

  return (
    <Card title="Translation" action={toggle}>
      {!open && <p className="text-[13px] text-fg-2">{settingsSummary(settings, glossaryEntries)}</p>}
      <div id="translation-settings" hidden={!open} className="flex flex-col gap-3">
        <fieldset>
          <legend className="mb-1.5 text-[12.5px] font-medium text-fg-2">Mode</legend>
          <div className="flex rounded-lg border border-line bg-surface-2 p-0.5">
            {MODES.map((m) => (
              <label
                key={m.value}
                className="flex-1 cursor-pointer rounded-md px-2 py-1.5 text-center text-[13px] text-muted has-checked:bg-surface has-checked:font-medium has-checked:text-fg has-checked:shadow-sm has-focus-visible:ring-3 has-focus-visible:ring-ring dark:has-checked:bg-surface-3"
              >
                <input
                  type="radio"
                  name="mode"
                  value={m.value}
                  checked={settings.mode === m.value}
                  onChange={() => onChange({ mode: m.value })}
                  className="sr-only"
                />
                {m.label}
              </label>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-muted">
            {settings.mode === "context"
              ? "Sends neighbouring lines, Hebrew gender rules and the character list with each request (about 20% more tokens)."
              : "Translates each block of 60 subtitles on its own."}
          </p>
        </fieldset>

        <div className="grid grid-cols-2 gap-2.5">
          <label className="flex flex-col gap-1.5 text-[12.5px] font-medium text-fg-2">
            Tone
            <select
              value={settings.tone}
              onChange={(e) => onChange({ tone: e.target.value as Tone })}
              className={`${inputClass} h-8.5`}
            >
              <option>Neutral</option>
              <option>Informal</option>
              <option>Formal</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-[12.5px] font-medium text-fg-2">
            Max chars per line
            <input
              type="number"
              min={20}
              max={80}
              value={settings.maxChars}
              onChange={(e) => onChange({ maxChars: Number(e.target.value) })}
              className={`${inputClass} h-8.5 font-mono`}
            />
          </label>
        </div>

        <Switch label="Preserve line breaks" checked={settings.preserveBreaks} onChange={(v) => onChange({ preserveBreaks: v })} />
        <Switch
          label="Remove sound effects"
          hint="[music], (sighs)"
          checked={settings.removeSoundEffects}
          onChange={(v) => onChange({ removeSoundEffects: v })}
        />

        <details className="group rounded-lg border border-line bg-surface-2" open={!!settings.glossary || undefined}>
          <summary className="flex cursor-pointer list-none items-center justify-between px-2.5 py-2 text-[13px] font-medium text-fg-2 focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none">
            <span>
              Glossary{" "}
              <span className="font-normal text-muted">
                {glossaryEntries ? `${glossaryEntries} term${glossaryEntries === 1 ? "" : "s"}` : "optional"}
              </span>
            </span>
            <span aria-hidden className="text-muted transition-transform group-open:rotate-180">
              ▾
            </span>
          </summary>
          <div className="px-2.5 pb-2.5">
            <textarea
              aria-label="Glossary"
              value={settings.glossary}
              maxLength={GLOSSARY_MAX_CHARS}
              onChange={(e) => onChange({ glossary: e.target.value })}
              placeholder={"One per line, e.g.\nJohn = ג׳ון\nFBI = FBI"}
              rows={4}
              className={`${inputClass} resize-y py-2 leading-snug`}
            />
            <p className="mt-1 text-xs text-muted">Forces consistent translations of names and terms.</p>
          </div>
        </details>
      </div>
    </Card>
  );
}
