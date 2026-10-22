export type Cue = {
  index: number;
  start: string;
  end: string;
  text: string;
};

export function parseSrt(srt: string): Cue[] {
  // Simple parser that handles common SRT structure:
  // index \n time --> time \n text lines... \n\n
  const blocks = srt.replace(/\r\n/g, "\n").trim().split(/\n{2,}/);
  const cues: Cue[] = [];

  for (const block of blocks) {
    const lines = block.split("\n");
    if (lines.length < 3) continue;

    const index = Number(lines[0].trim());
    const timeLine = lines[1].trim();
    const m = timeLine.match(
      /^(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})/
    );
    if (!m || !Number.isFinite(index)) continue;

    const text = lines.slice(2).join("\n").trim();
    cues.push({ index, start: m[1], end: m[2], text });
  }

  return cues;
}
