import { matchBracket } from "./scanner.ts";

export type ErasableIssue = { what: string; fix: string; at: number };

const KEYWORDS: { pattern: RegExp; what: string; fix: string }[] = [
  {
    pattern: /^enum\s+[A-Za-z_$]/,
    what: "an enum",
    fix: "use a union of string literals, or a `const` object",
  },
  {
    pattern: /^namespace\s+[A-Za-z_$]/,
    what: "a namespace",
    fix: "use a module, or plain exported consts",
  },
  {
    pattern: /^import\s+[A-Za-z_$][A-Za-z0-9_$]*\s*=/,
    what: "an `import =`",
    fix: "use a normal import",
  },
];

const PARAMETER_PROPERTY =
  /(^|[^A-Za-z0-9_$])(private|public|protected|readonly|override)\s+[A-Za-z_$]/;

/**
 * Find TypeScript in an island that bel cannot run.
 *
 * The compiled output is executed by a runtime that *strips* types rather than
 * compiling them (Node, Deno, Bun), and a construct with a runtime value
 * cannot be stripped. The checks look at the start of a line — where these
 * constructs are written — and inside a constructor's parameter list, so a
 * mention in a comment or a string does not trip them.
 */
export function findNonErasable(text: string): ErasableIssue | null {
  let offset = 0;
  for (const line of text.split("\n")) {
    const leading = line.length - line.trimStart().length;
    const trimmed = line.trimStart();
    for (const { pattern, what, fix } of KEYWORDS) {
      if (pattern.test(trimmed)) return { what, fix, at: offset + leading };
    }
    offset += line.length + 1;
  }

  for (const at of findConstructors(text)) {
    const open = text.indexOf("(", at);
    if (open === -1) continue;
    const found = matchBracket(text, open);
    if (!found.ok) continue;
    if (PARAMETER_PROPERTY.test(text.slice(open + 1, found.end - 1))) {
      return {
        what: "a parameter property",
        fix: "declare the field and assign it in the constructor",
        at,
      };
    }
  }

  return null;
}

function findConstructors(text: string): number[] {
  const found: number[] = [];
  const pattern = /(^|[^A-Za-z0-9_$])constructor\s*\(/g;
  for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
    found.push(match.index + (match[1]?.length ?? 0));
  }
  return found;
}
