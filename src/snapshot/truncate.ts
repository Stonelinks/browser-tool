export interface TruncateResult {
  text: string;
  truncated: boolean;
}

export function truncateSnapshot(
  text: string,
  maxChars: number,
): TruncateResult {
  if (text.length <= maxChars) return { text, truncated: false };
  const target = Math.floor(maxChars * 0.95);
  const slice = text.slice(0, target);
  const lastNewline = slice.lastIndexOf("\n");
  const cutoff = lastNewline > 0 ? lastNewline : target;
  const remaining = text.length - cutoff;
  const remainingLines = text.slice(cutoff).split("\n").length - 1;
  return {
    text:
      text.slice(0, cutoff) +
      `\n[... ${remainingLines} more lines truncated, ${remaining} chars elided ...]`,
    truncated: true,
  };
}
