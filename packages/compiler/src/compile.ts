import type { Program } from "./ast.ts";
import { generate } from "./codegen.ts";
import type { GenerateOptions } from "./codegen.ts";
import { parseBel } from "./parser.ts";

/** Parse bel source and compile it to TypeScript. */
export function compile(source: string, options: Omit<GenerateOptions, "source"> = {}): string {
  return generate(parseBel(source), { ...options, source });
}

export type { Program };
