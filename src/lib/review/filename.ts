// Characters not allowed in Windows file names, and control characters.
const isUnsafe = (ch: string) => '\\/:*?"<>|'.includes(ch) || ch.charCodeAt(0) < 32;

// Name of the downloaded file, derived from the input file's name:
// "Movie.en.srt" -> "Movie.he.srt", partial -> "Movie.PARTIAL.he.srt".
export function exportName(inputName: string | null | undefined, partial = false): string {
  const base =
    [...(inputName ?? "")]
      .map((ch) => (isUnsafe(ch) ? "_" : ch))
      .join("")
      .replace(/\.srt$/i, "")
      .replace(/\.(en|eng|english)$/i, "")
      .trim()
      .replace(/^\.+|\.+$/g, "") || "translated";
  return `${base}${partial ? ".PARTIAL" : ""}.he.srt`;
}
