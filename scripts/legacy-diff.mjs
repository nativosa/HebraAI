// Explains differences from the immutable Stage 0 references with the
// allowlist in fixtures/expected/changes.json: every differing case must be
// listed with a reason, and every listed case must still differ.

export function reviewLegacyDiffs(kind, differing, allow = {}) {
  const lines = [];
  const failures = [];
  for (const name of [...differing].sort()) {
    if (allow[name]) {
      lines.push(`DIFF  ${kind} ${name} vs legacy — ${allow[name]}`);
    } else {
      failures.push(`${kind} ${name}`);
      lines.push(`FAIL  ${kind} ${name} differs from legacy and is not listed in fixtures/expected/changes.json`);
    }
  }
  for (const name of Object.keys(allow).sort()) {
    if (!differing.includes(name)) {
      failures.push(`stale ${kind} ${name}`);
      lines.push(`FAIL  ${kind} ${name} is listed in changes.json but matches legacy (stale entry)`);
    }
  }
  return { lines, failures };
}
