import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createJevRuntime } from "@bel/runtime";
import type { BelRuntime, Evaluation, Question } from "@bel/runtime";

export type CassetteOptions = {
  /**
   * Where the recording lives. A `URL` is resolved as the test file wrote it,
   * which is what generated tests pass: a bare string would resolve against
   * the process's working directory instead.
   */
  path: string | URL;
  /** Record instead of replay. Defaults to `BEL_RECORD=1`. */
  record?: boolean;
  /** The transport to record from. Defaults to the live TypeSafe service. */
  transport?: BelRuntime;
  /** The model to ask for while recording. Defaults to `BEL_MODEL`. */
  model?: string;
};

type Cassette = {
  version: 1;
  /** The concrete model the service resolved `jev-latest` to, once known. */
  model: string | null;
  entries: Record<string, Evaluation[]>;
};

/**
 * Record live answers once, then replay them.
 *
 * The key is a hash of the whole request — model, questions and state — so a
 * test that changes its input looks for a different answer instead of
 * replaying a response to a question it no longer asks.
 *
 * That also means state has to be deterministic: a `Date.now()` or a random id
 * changes the key and misses on every run. Build the fixture, do not derive it
 * from the clock.
 */
export function createCassetteRuntime(options: CassetteOptions): BelRuntime {
  const record = options.record ?? process.env.BEL_RECORD === "1";
  const path = typeof options.path === "string" ? options.path : fileURLToPath(options.path);

  return {
    async evaluate(questions: Question[], state: unknown): Promise<Evaluation[]> {
      const model = options.model ?? process.env.BEL_MODEL ?? "jev-latest";
      const key = cassetteKey(model, questions, state);
      const cassette = read(path);

      const recorded = cassette.entries[key];
      if (recorded !== undefined && !record) return recorded;

      if (!record) {
        throw new Error(
          `no recording for this request in ${path} (key ${key.slice(0, 12)}…).\n` +
            `Re-record with BEL_RECORD=1 if the question or the state changed on purpose.`,
        );
      }

      const transport = options.transport ?? createJevRuntime();
      const evaluations = await transport.evaluate(questions, state);
      const resolved = resolvedModelOf(transport);
      cassette.model = resolved ?? model;
      cassette.entries[key] = evaluations;
      write(path, cassette);
      return evaluations;
    },
  };
}

/** Read a recording without running anything. */
export function readCassette(path: string): { model: string | null; entries: number } {
  const cassette = read(path);
  return { model: cassette.model, entries: Object.keys(cassette.entries).length };
}

function cassetteKey(model: string, questions: Question[], state: unknown): string {
  const request = canonical({ model, questions, state });
  return createHash("sha256").update(request).digest("hex");
}

function read(path: string): Cassette {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return { version: 1, model: null, entries: {} };
  }
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`${path} is not a cassette`);
  }
  const cassette = parsed as Partial<Cassette>;
  return {
    version: 1,
    model: cassette.model ?? null,
    entries: cassette.entries ?? {},
  };
}

function write(path: string, cassette: Cassette): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${canonical(cassette)}\n`);
}

function resolvedModelOf(transport: BelRuntime): string | null {
  const candidate = transport as { resolvedModel?: () => string | null };
  return typeof candidate.resolvedModel === "function" ? candidate.resolvedModel() : null;
}

/** JSON with object keys in sorted order, so the same request always hashes the same. */
function canonical(value: unknown): string {
  return JSON.stringify(sort(value));
}

function sort(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sort);
  if (typeof value !== "object" || value === null) return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    out[key] = sort((value as Record<string, unknown>)[key]);
  }
  return out;
}
