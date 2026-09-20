const WORD = /[A-Za-z_][A-Za-z0-9_]*/g;

/** The identifier a position sits in, if it sits in one. */
export function wordAt(text: string, offset: number): string | null {
  for (const match of text.matchAll(WORD)) {
    const start = match.index;
    const end = start + match[0].length;
    if (offset >= start && offset <= end) return match[0];
  }
  return null;
}

/** The identifier a position sits in, and where it starts. */
export function wordWithOffset(
  text: string,
  offset: number,
): { word: string; start: number } | null {
  for (const match of text.matchAll(WORD)) {
    const start = match.index;
    const end = start + match[0].length;
    if (offset >= start && offset <= end) return { word: match[0], start };
  }
  return null;
}
