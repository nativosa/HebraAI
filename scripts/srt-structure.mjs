#!/usr/bin/env node
// Structural inspection/comparison of SRT files. Zero dependencies.
//
//   node scripts/srt-structure.mjs inspect <file>
//   node scripts/srt-structure.mjs compare <a> <b>
//
// "compare" checks cue count, index sequence and every "start --> end" pair.
// Cue text is ignored, so it works for English input vs. Hebrew output.
// It prints only structural data (never cue text) and exits 1 on any difference.

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const TIME_LINE = /^\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{3})/;

export function inspectSrt(buf) {
  const hasBom = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
  const raw = buf.toString("utf8").replace(/^﻿/, "");
  const crlf = (raw.match(/\r\n/g) || []).length;
  const lf = (raw.match(/\n/g) || []).length - crlf;
  const eol = crlf && lf ? "mixed" : crlf ? "CRLF" : lf ? "LF" : "none";

  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const cues = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(TIME_LINE);
    if (!m) continue;
    const prev = i > 0 ? lines[i - 1].trim() : "";
    cues.push({ index: /^\d+$/.test(prev) ? Number(prev) : null, start: m[1], end: m[2] });
  }

  return {
    bytes: buf.length,
    sha256: createHash("sha256").update(buf).digest("hex"),
    bom: hasBom,
    eol,
    cueCount: cues.length,
    cues,
  };
}

export function compareStructure(a, b) {
  const diffs = [];
  if (a.cueCount !== b.cueCount) diffs.push(`cue count: ${a.cueCount} vs ${b.cueCount}`);
  const n = Math.min(a.cues.length, b.cues.length);
  for (let i = 0; i < n; i++) {
    const x = a.cues[i];
    const y = b.cues[i];
    if (x.index !== y.index) diffs.push(`cue #${i + 1}: index ${x.index} vs ${y.index}`);
    if (x.start !== y.start || x.end !== y.end) {
      diffs.push(`cue #${i + 1}: time ${x.start} --> ${x.end} vs ${y.start} --> ${y.end}`);
    }
  }
  return diffs;
}

function summary(info) {
  const idx = info.cues.map((c) => c.index ?? "?");
  return [
    `bytes:    ${info.bytes}`,
    `sha256:   ${info.sha256}`,
    `bom:      ${info.bom}`,
    `eol:      ${info.eol}`,
    `cues:     ${info.cueCount}`,
    `indices:  ${idx.length > 20 ? idx.slice(0, 20).join(",") + ",…" : idx.join(",")}`,
  ].join("\n");
}

function main(argv) {
  const [cmd, a, b] = argv;
  if (cmd === "inspect" && a) {
    console.log(summary(inspectSrt(readFileSync(a))));
    return 0;
  }
  if (cmd === "compare" && a && b) {
    const diffs = compareStructure(inspectSrt(readFileSync(a)), inspectSrt(readFileSync(b)));
    if (diffs.length === 0) {
      console.log("STRUCTURE MATCH");
      return 0;
    }
    console.log(`STRUCTURE MISMATCH (${diffs.length} difference(s)):`);
    for (const d of diffs.slice(0, 50)) console.log(`  ${d}`);
    if (diffs.length > 50) console.log(`  … ${diffs.length - 50} more`);
    return 1;
  }
  console.error("Usage:\n  srt-structure.mjs inspect <file>\n  srt-structure.mjs compare <a> <b>");
  return 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main(process.argv.slice(2));
}
