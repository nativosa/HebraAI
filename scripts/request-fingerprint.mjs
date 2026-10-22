// Privacy-safe fingerprints of the OpenAI requests the app sends, used by the
// offline harness to prove refactors do not change the model, prompt, payload
// or JSON schema. Only SHA-256 hashes and minimal metadata are stored — never
// prompts, subtitle text or keys.
//
// Hashes are computed over canonical JSON (object keys sorted recursively,
// array order kept), so they do not depend on property insertion order.

import { createHash } from "node:crypto";

export const FINGERPRINT_VERSION = 1;
const FIELDS = ["model", "instructions", "input", "text"];

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

const sha256 = (value) => createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");

// One request body -> { items, sha256: { request, model, instructions, input, text } }.
// `items` is the number of subtitle items in the request (metadata only).
export function fingerprintRequest(body) {
  const hashes = { request: sha256(body) };
  for (const f of FIELDS) hashes[f] = sha256(body?.[f] ?? null);
  return { items: countItems(body), sha256: hashes };
}

function countItems(body) {
  const text = body?.input?.[0]?.content?.[0]?.text ?? "";
  const i = text.indexOf("\n\n[");
  try {
    return i < 0 ? 0 : JSON.parse(text.slice(i + 2)).length;
  } catch {
    return 0;
  }
}

// cases: { caseName: [requestBody, ...] } in the order the app sent them.
export function buildFingerprintFile(cases) {
  const out = {};
  for (const name of Object.keys(cases).sort()) out[name] = cases[name].map(fingerprintRequest);
  return { version: FINGERPRINT_VERSION, hash: "sha256(canonical JSON)", cases: out };
}

// Names of the cases whose requests differ (incl. cases present on one side only).
export function changedCases(expected, actual) {
  const names = new Set([...Object.keys(expected?.cases ?? {}), ...Object.keys(actual?.cases ?? {})]);
  return [...names].sort().filter((n) => canonicalJson(expected?.cases?.[n] ?? null) !== canonicalJson(actual?.cases?.[n] ?? null));
}

// Returns human-readable differences (case, request number, field names only).
export function compareFingerprints(expected, actual) {
  const diffs = [];
  if (expected?.version !== actual.version) diffs.push(`version: expected ${expected?.version}, got ${actual.version}`);
  const names = new Set([...Object.keys(expected?.cases ?? {}), ...Object.keys(actual.cases)]);
  for (const name of [...names].sort()) {
    const e = expected?.cases?.[name];
    const a = actual.cases[name];
    if (!e) { diffs.push(`${name}: not in committed fingerprints`); continue; }
    if (!a) { diffs.push(`${name}: no longer produced`); continue; }
    if (e.length !== a.length) diffs.push(`${name}: expected ${e.length} request(s), got ${a.length}`);
    for (let i = 0; i < Math.min(e.length, a.length); i++) {
      const changed = Object.keys(e[i].sha256).filter((f) => e[i].sha256[f] !== a[i].sha256[f]);
      if (e[i].items !== a[i].items) changed.push(`items ${e[i].items}->${a[i].items}`);
      if (changed.length) diffs.push(`${name} request ${i + 1}: ${changed.join(", ")} changed`);
    }
  }
  return diffs;
}
