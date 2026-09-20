/**
 * Bracket matching for the TypeScript islands embedded in bel source.
 *
 * The bel grammar finds the extent of an action island by asking for the
 * offset just past the matching closer of the `{` or `(` that opens it. A
 * naive brace counter is wrong as soon as a brace appears inside a string, a
 * template literal interpolation, or a comment, so this scanner tracks those
 * regions explicitly.
 *
 * Regex literals are recognised with the usual "is a value expected here?"
 * heuristic: a `/` starts a regex after an operator, an opening bracket or a
 * keyword, and is division after anything else. The heuristic is right in
 * practice but not a lexer; see RFC 0001, "Known ceilings".
 */

export type ScanResult =
  | { ok: true; end: number }
  | { ok: false; reason: "not-a-bracket" | "unterminated" | "mismatch"; at: number };

type BracketKind = "brace" | "paren" | "bracket";

type Frame = { kind: BracketKind; open: number } | { kind: "template"; open: number };

const OPENERS: Record<string, BracketKind | undefined> = {
  "{": "brace",
  "(": "paren",
  "[": "bracket",
};

const CLOSERS: Record<string, BracketKind | undefined> = {
  "}": "brace",
  ")": "paren",
  "]": "bracket",
};

/** A regex may follow these, because a value is expected next. */
const REGEX_PRECEDING_CHARS = new Set("(,=:[!&|?{};+-*%~^<>");

/** A regex may follow these keywords, because a value is expected next. */
const REGEX_PRECEDING_WORDS = new Set([
  "await",
  "case",
  "delete",
  "do",
  "else",
  "in",
  "instanceof",
  "new",
  "of",
  "return",
  "typeof",
  "void",
  "yield",
]);

const IDENT_START = /[A-Za-z_$]/;
const IDENT_PART = /[A-Za-z0-9_$]/;

/**
 * Find the end of the region opened by the bracket at `openOffset`.
 *
 * Returns the offset just past the matching closer, or why it could not be
 * found. `at` is the offset of the offending character (the opener for an
 * unterminated region).
 */
export function matchBracket(source: string, openOffset: number): ScanResult {
  const kind = OPENERS[source[openOffset] ?? ""];
  if (kind === undefined) return { ok: false, reason: "not-a-bracket", at: openOffset };

  const stack: Frame[] = [{ kind, open: openOffset }];
  let i = openOffset + 1;

  /**
   * The last code token, used only to decide whether a `/` starts a regex.
   * The two travel together, so they are one value: setting the character
   * always clears the word.
   */
  const prev = { char: "", word: "" };
  const setPrev = (char: string, word = ""): void => {
    prev.char = char;
    prev.word = word;
  };

  while (i < source.length) {
    const frame = stack[stack.length - 1];

    if (frame?.kind === "template") {
      const c = source[i];
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === "`") {
        stack.pop();
        i += 1;
        setPrev("`");
        continue;
      }
      if (c === "$" && source[i + 1] === "{") {
        stack.push({ kind: "brace", open: i + 1 });
        i += 2;
        setPrev("");
        continue;
      }
      i += 1;
      continue;
    }

    const c = source[i] as string;

    if (c === "/" && source[i + 1] === "/") {
      const next = source.indexOf("\n", i);
      i = next === -1 ? source.length : next;
      continue;
    }
    if (c === "/" && source[i + 1] === "*") {
      const next = source.indexOf("*/", i + 2);
      if (next === -1) return { ok: false, reason: "unterminated", at: openOffset };
      i = next + 2;
      continue;
    }
    if (c === "/" && startsRegex(prev)) {
      const next = skipRegex(source, i);
      if (next !== -1) {
        i = next;
        setPrev("/");
        continue;
      }
    }
    if (c === '"' || c === "'") {
      i = skipString(source, i);
      setPrev(c);
      continue;
    }
    if (c === "`") {
      stack.push({ kind: "template", open: i });
      i += 1;
      continue;
    }

    const opener = OPENERS[c];
    if (opener !== undefined) {
      stack.push({ kind: opener, open: i });
      i += 1;
      setPrev(c);
      continue;
    }

    const closer = CLOSERS[c];
    if (closer !== undefined) {
      if (closer !== frame?.kind) return { ok: false, reason: "mismatch", at: i };
      stack.pop();
      i += 1;
      if (stack.length === 0) return { ok: true, end: i };
      setPrev(c);
      continue;
    }

    if (/\s/.test(c)) {
      i += 1;
      continue;
    }

    if (IDENT_START.test(c)) {
      let j = i;
      while (j < source.length && IDENT_PART.test(source[j] as string)) j += 1;
      setPrev(source[j - 1] as string, source.slice(i, j));
      i = j;
      continue;
    }

    setPrev(c);
    i += 1;
  }

  return { ok: false, reason: "unterminated", at: openOffset };
}

function startsRegex(prev: { char: string; word: string }): boolean {
  if (prev.char === "") return true;
  if (prev.word !== "" && REGEX_PRECEDING_WORDS.has(prev.word)) return true;
  return REGEX_PRECEDING_CHARS.has(prev.char);
}

/**
 * Skip a regex literal starting at `i`. Returns -1 when the `/` cannot be one
 * — a regex does not span lines, so a newline before the closing `/` means
 * this was division.
 */
function skipRegex(source: string, i: number): number {
  let j = i + 1;
  let inClass = false;
  while (j < source.length) {
    const c = source[j];
    if (c === "\\") {
      j += 2;
      continue;
    }
    if (c === "\n") return -1;
    if (inClass) {
      if (c === "]") inClass = false;
      j += 1;
      continue;
    }
    if (c === "[") {
      inClass = true;
      j += 1;
      continue;
    }
    if (c === "/") {
      j += 1;
      while (j < source.length && /[a-z]/i.test(source[j] as string)) j += 1;
      return j;
    }
    j += 1;
  }
  return -1;
}

/** Skip a quoted string starting at `i`. An unterminated string runs to EOF. */
function skipString(source: string, i: number): number {
  const quote = source[i];
  let j = i + 1;
  while (j < source.length) {
    const c = source[j];
    if (c === "\\") {
      j += 2;
      continue;
    }
    if (c === quote) return j + 1;
    if (c === "\n") return j;
    j += 1;
  }
  return source.length;
}
