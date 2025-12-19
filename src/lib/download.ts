export function downloadTextAsFile(
  text: string,
  filename: string,
  mimeType = "application/x-subrip; charset=utf-8"
) {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
