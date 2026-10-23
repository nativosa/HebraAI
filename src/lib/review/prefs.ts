// Preferences kept in the browser's localStorage. An allow-list: theme,
// translation settings and export options. Never subtitle text,
// translations, edits, character sheets or story notes.

import { GLOSSARY_MAX_CHARS } from "@/lib/translation/options";
import type { Settings } from "@/lib/types";
import { DEFAULT_EXPORT_OPTIONS, type ExportOptions } from "./export";

export type Theme = "system" | "light" | "dark";

// Settings without the story notes, which describe one film.
export type SavedSettings = Omit<Settings, "notes">;

export type Prefs = { theme: Theme; settings: SavedSettings; export: ExportOptions };

export const PREFS_KEY = "hebraai.prefs.v1";

export const DEFAULT_SETTINGS: Settings = {
  mode: "classic",
  tone: "Neutral",
  preserveBreaks: true,
  maxChars: 42,
  glossary: "",
  removeSoundEffects: true,
  notes: "",
};

export const DEFAULT_PREFS: Prefs = {
  theme: "system",
  settings: {
    mode: DEFAULT_SETTINGS.mode,
    tone: DEFAULT_SETTINGS.tone,
    preserveBreaks: DEFAULT_SETTINGS.preserveBreaks,
    maxChars: DEFAULT_SETTINGS.maxChars,
    glossary: DEFAULT_SETTINGS.glossary,
    removeSoundEffects: DEFAULT_SETTINGS.removeSoundEffects,
  },
  export: DEFAULT_EXPORT_OPTIONS,
};

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const oneOf = <T extends string>(v: unknown, values: readonly T[], fallback: T): T =>
  values.includes(v as T) ? (v as T) : fallback;
const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);

// Reads stored preferences; each missing or invalid field gets its default.
export function parsePrefs(raw: unknown): Prefs {
  const p = obj(raw);
  const s = obj(p.settings);
  const e = obj(p.export);
  const d = DEFAULT_PREFS;
  const maxChars = s.maxChars;
  return {
    theme: oneOf(p.theme, ["system", "light", "dark"], d.theme),
    settings: {
      mode: oneOf(s.mode, ["classic", "context"], d.settings.mode),
      tone: oneOf(s.tone, ["Neutral", "Informal", "Formal"], d.settings.tone),
      preserveBreaks: bool(s.preserveBreaks, d.settings.preserveBreaks),
      maxChars:
        typeof maxChars === "number" && Number.isFinite(maxChars) && maxChars >= 20 && maxChars <= 80
          ? maxChars
          : d.settings.maxChars,
      glossary:
        typeof s.glossary === "string" && s.glossary.length <= GLOSSARY_MAX_CHARS ? s.glossary : d.settings.glossary,
      removeSoundEffects: bool(s.removeSoundEffects, d.settings.removeSoundEffects),
    },
    export: { bom: bool(e.bom, d.export.bom), renumber: bool(e.renumber, d.export.renumber) },
  };
}

// The stored form: only the allowed fields, whatever else `settings` holds.
export function serializePrefs(theme: Theme, settings: Settings, exportOptions: ExportOptions): string {
  const { mode, tone, preserveBreaks, maxChars, glossary, removeSoundEffects } = settings;
  const prefs: Prefs = {
    theme,
    settings: { mode, tone, preserveBreaks, maxChars, glossary, removeSoundEffects },
    export: { bom: exportOptions.bom, renumber: exportOptions.renumber },
  };
  return JSON.stringify(prefs);
}

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

// Defaults when storage is unavailable, empty or corrupt.
export function loadPrefs(storage: Storage | undefined): Prefs {
  try {
    const raw = storage?.getItem(PREFS_KEY);
    return raw ? parsePrefs(JSON.parse(raw)) : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

// Returns false when the preferences could not be stored.
export function savePrefs(storage: Storage | undefined, theme: Theme, settings: Settings, exportOptions: ExportOptions): boolean {
  try {
    storage?.setItem(PREFS_KEY, serializePrefs(theme, settings, exportOptions));
    return !!storage;
  } catch {
    return false;
  }
}
