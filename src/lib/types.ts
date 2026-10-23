export type Tone = "Neutral" | "Informal" | "Formal";

export type Mode = "classic" | "context";

export type Settings = {
  mode: Mode;
  tone: Tone;
  preserveBreaks: boolean;
  maxChars: number;
  glossary: string;
  removeSoundEffects: boolean;
  // Context mode only: background about the story for the model.
  notes: string;
};