import { readFileSync } from "node:fs";
import { join } from "node:path";

const FIXTURES = join(process.cwd(), "fixtures");

// Synthetic input from fixtures/srt/.
export function readSrtFixture(name: string): string {
  return readFileSync(join(FIXTURES, "srt", name), "utf8");
}

// Output captured from the running app in Stage 0 (fake translator: "[HE] " prefix).
export function readLegacyBaseline(name: string): string {
  return readFileSync(join(FIXTURES, "legacy-baseline", name), "utf8");
}

// Current expected output (fixtures/expected/), produced by the app with the
// fake translator. Differences from the legacy baseline are listed in
// fixtures/expected/changes.json.
export function readExpected(name: string): string {
  return readFileSync(join(FIXTURES, "expected", name), "utf8");
}

export function readGolden() {
  return JSON.parse(readFileSync(join(process.cwd(), "tests", "golden", "legacy-golden.json"), "utf8"));
}
