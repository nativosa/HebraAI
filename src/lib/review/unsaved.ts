// Unsaved work that a new file or a new translation would discard.
// exported: the result, with its current edits, was downloaded or copied.
export type WorkState = { hasResult: boolean; hasEdits: boolean; exported: boolean };

// The warning to confirm before discarding the work, or null when nothing
// would be lost. Settings changes never discard anything.
export function unsavedWarning({ hasResult, hasEdits, exported }: WorkState): string | null {
  if (!hasResult || exported) return null;
  return hasEdits
    ? "Your manual edits have not been exported and will be lost."
    : "The current translation has not been downloaded or copied and will be replaced.";
}
