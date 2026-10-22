// Plans the API requests a case will cause, using the app's own modules
// (parser, sound-effect filter, options, prompt) so estimates follow the
// requests the route actually builds. The modules are passed in by the caller
// (Vitest imports them via the "@" alias, the runner via file URLs).

import { buildRequest } from "./request.mjs";
import { NO_ESTIMATE, addEstimates, estimateRequest } from "./estimate.mjs";

// Must equal CHUNK_SIZE in src/lib/translation/pipeline.ts (tested).
export const CHUNK = 60;

// app: { parseSrt, removeSoundEffectCues, parseTranslateOptions, buildInstructions, buildChunkRequest }
export function planCase(c, mode, app) {
  if (mode !== "classic") throw new Error(`no request plan for mode ${mode} yet`);
  const { fields, srt } = buildRequest(c, mode);
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  const options = app.parseTranslateOptions(form);
  const instructions = app.buildInstructions(options);
  let cues = app.parseSrt(srt).cues;
  if (options.removeSoundEffects) cues = app.removeSoundEffectCues(cues);

  let estimate = NO_ESTIMATE;
  for (let i = 0; i < cues.length; i += CHUNK) {
    const part = cues.slice(i, i + CHUNK);
    const request = app.buildChunkRequest(instructions, part);
    estimate = addEstimates(
      estimate,
      estimateRequest({
        requestChars: JSON.stringify(request).length,
        sourceChars: part.reduce((n, cue) => n + cue.text.length, 0),
        items: part.length,
      })
    );
  }
  return estimate;
}
