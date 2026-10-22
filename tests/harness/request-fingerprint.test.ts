import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  buildFingerprintFile,
  canonicalJson,
  compareFingerprints,
  fingerprintRequest,
} from "../../scripts/request-fingerprint.mjs";

const body = {
  model: "m",
  instructions: "secret prompt",
  input: [{ role: "user", content: [{ type: "input_text", text: "Translate.\n\n[{\"index\":1,\"text\":\"Hello\"}]" }] }],
  text: { format: { type: "json_schema", strict: true } },
};

describe("canonicalJson", () => {
  it("sorts object keys recursively and keeps array order", () => {
    expect(canonicalJson({ b: 1, a: { d: [2, 1], c: null } })).toBe('{"a":{"c":null,"d":[2,1]},"b":1}');
  });

  it("does not depend on property insertion order", () => {
    const reordered = { text: body.text, input: body.input, instructions: body.instructions, model: body.model };
    expect(canonicalJson(reordered)).toBe(canonicalJson(body));
  });
});

describe("fingerprintRequest", () => {
  it("hashes each field and counts subtitle items", () => {
    const fp = fingerprintRequest(body);
    expect(fp.items).toBe(1);
    expect(Object.keys(fp.sha256)).toEqual(["request", "model", "instructions", "input", "text"]);
    for (const h of Object.values(fp.sha256)) expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("contains no request text", () => {
    const serialized = JSON.stringify(buildFingerprintFile({ case: [body] }));
    for (const plain of ["secret prompt", "Hello", "Translate", "json_schema"]) expect(serialized).not.toContain(plain);
  });
});

describe("compareFingerprints", () => {
  const expected = buildFingerprintFile({ a: [body], b: [body, body] });

  it("reports nothing for identical requests", () => {
    expect(compareFingerprints(expected, buildFingerprintFile({ b: [body, body], a: [body] }))).toEqual([]);
  });

  it("names the case, request and changed field only", () => {
    const changed = { ...body, instructions: "other prompt" };
    expect(compareFingerprints(expected, buildFingerprintFile({ a: [body], b: [body, changed] }))).toEqual([
      "b request 2: request, instructions changed",
    ]);
  });

  it("reports missing, extra and re-chunked cases", () => {
    expect(compareFingerprints(expected, buildFingerprintFile({ b: [body], c: [body] }))).toEqual([
      "a: no longer produced",
      "b: expected 2 request(s), got 1",
      "c: not in committed fingerprints",
    ]);
  });
});

describe("committed fixtures/legacy-requests.json", () => {
  it("stores only hashes and item counts", () => {
    const file = JSON.parse(readFileSync("fixtures/legacy-requests.json", "utf8"));
    for (const requests of Object.values(file.cases) as { items: number; sha256: Record<string, string> }[][]) {
      for (const r of requests) {
        expect(Object.keys(r).sort()).toEqual(["items", "sha256"]);
        expect(Number.isInteger(r.items)).toBe(true);
        for (const h of Object.values(r.sha256)) expect(h).toMatch(/^[0-9a-f]{64}$/);
      }
    }
  });
});
