export type Tone = "Neutral" | "Informal" | "Formal";

export type Settings = {
  tone: Tone;
  preserveBreaks: boolean;
  maxChars: number;
  glossary: string;
  removeSoundEffects: boolean;
};