/** Small text helpers shared by the code generators. */

/** A double-quoted TypeScript string literal. */
export function quote(text: string): string {
  return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Split on commas that are not inside brackets. */
export function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of text) {
    if ("({[<".includes(char)) depth += 1;
    if (")}]>".includes(char)) depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts;
}

/** Whether a chunk of TypeScript mentions an identifier. */
export function readsName(text: string, name: string): boolean {
  return new RegExp(`(^|[^A-Za-z0-9_$])${name}(?![A-Za-z0-9_$])`).test(text);
}
