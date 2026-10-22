#!/usr/bin/env node
// Offline check of the OpenAI endpoint guard in src/lib/openai-client.ts.
// Only constructs clients (no requests are made). Requires Node >= 22.18 / 23.6
// for built-in TypeScript type stripping.
//
//   npm run check:openai-endpoint

import {
  createOpenAIClient,
  OFFICIAL_OPENAI_BASE_URL,
  OFFLINE_TEST_API_KEY,
  OFFLINE_TEST_MODE_ENV,
} from "../src/lib/openai-client.ts";
import { FAKE_API_KEY } from "./fake-openai.mjs";

const REAL_LOOKING_KEY = "sk-proj-this-is-not-a-real-key";
const FAKE = OFFLINE_TEST_API_KEY;
const TEST = { [OFFLINE_TEST_MODE_ENV]: "1" };

const cases = [
  // Default: always the official endpoint, whatever OPENAI_BASE_URL says.
  ["no override", { OPENAI_API_KEY: REAL_LOOKING_KEY }, OFFICIAL_OPENAI_BASE_URL],
  ["inherited remote OPENAI_BASE_URL ignored", { OPENAI_API_KEY: REAL_LOOKING_KEY, OPENAI_BASE_URL: "https://evil.example/v1" }, OFFICIAL_OPENAI_BASE_URL],
  ["inherited loopback OPENAI_BASE_URL ignored", { OPENAI_API_KEY: FAKE, OPENAI_BASE_URL: "http://127.0.0.1:9/v1" }, OFFICIAL_OPENAI_BASE_URL],
  ["test mode must be exactly '1'", { [OFFLINE_TEST_MODE_ENV]: "true", OPENAI_API_KEY: FAKE, OPENAI_BASE_URL: "http://127.0.0.1:9/v1" }, OFFICIAL_OPENAI_BASE_URL],
  // Test mode: loopback + fake key only, otherwise refuse.
  ["test mode, IPv4 loopback", { ...TEST, OPENAI_API_KEY: FAKE, OPENAI_BASE_URL: "http://127.0.0.1:4010/v1" }, "http://127.0.0.1:4010/v1"],
  ["test mode, IPv6 loopback", { ...TEST, OPENAI_API_KEY: FAKE, OPENAI_BASE_URL: "http://[::1]:4010/v1" }, "http://[::1]:4010/v1"],
  ["test mode, real key", { ...TEST, OPENAI_API_KEY: REAL_LOOKING_KEY, OPENAI_BASE_URL: "http://127.0.0.1:4010/v1" }, "throws"],
  ["test mode, no key", { ...TEST, OPENAI_BASE_URL: "http://127.0.0.1:4010/v1" }, "throws"],
  ["test mode, no URL", { ...TEST, OPENAI_API_KEY: FAKE }, "throws"],
  ["test mode, invalid URL", { ...TEST, OPENAI_API_KEY: FAKE, OPENAI_BASE_URL: "not a url" }, "throws"],
  ["test mode, remote host", { ...TEST, OPENAI_API_KEY: FAKE, OPENAI_BASE_URL: "http://evil.example/v1" }, "throws"],
  ["test mode, official endpoint", { ...TEST, OPENAI_API_KEY: FAKE, OPENAI_BASE_URL: OFFICIAL_OPENAI_BASE_URL }, "throws"],
  ["test mode, https loopback", { ...TEST, OPENAI_API_KEY: FAKE, OPENAI_BASE_URL: "https://127.0.0.1:4010/v1" }, "throws"],
  ["test mode, 'localhost' name", { ...TEST, OPENAI_API_KEY: FAKE, OPENAI_BASE_URL: "http://localhost:4010/v1" }, "throws"],
  ["test mode, loopback-looking hostname", { ...TEST, OPENAI_API_KEY: FAKE, OPENAI_BASE_URL: "http://127.0.0.1.evil.example/v1" }, "throws"],
  ["test mode, userinfo trick", { ...TEST, OPENAI_API_KEY: FAKE, OPENAI_BASE_URL: "http://127.0.0.1@evil.example/v1" }, "throws"],
  ["test mode, credentials in URL", { ...TEST, OPENAI_API_KEY: FAKE, OPENAI_BASE_URL: "http://u:p@127.0.0.1:4010/v1" }, "throws"],
];

let failures = 0;
const check = (ok, label, detail) => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
};

check(FAKE_API_KEY === OFFLINE_TEST_API_KEY, "fake server key matches the route's offline test key");

for (const [label, env, expected] of cases) {
  let actual;
  try {
    actual = createOpenAIClient(env).baseURL;
  } catch {
    actual = "throws";
  }
  check(actual === expected, label, actual === expected ? "" : `expected ${expected}, got ${actual}`);
}

console.log(failures ? `\n${failures} failure(s)` : `\nAll ${cases.length + 1} endpoint checks pass.`);
process.exitCode = failures ? 1 : 0;
