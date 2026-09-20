#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BelError } from "./ast.ts";
import { compile } from "./compile.ts";
import { parseBel } from "./parser.ts";
import { generateTests } from "./testgen.ts";

const USAGE = `bel — compile .bel source to TypeScript

Usage:
  bel build [options] <file.bel>...
  bel test [--conjoin] <file.bel>...

Commands:
  build   compile to <name>.bel.ts; test and mock declarations are stripped
  test    compile the tests to <name>.bel.test.ts and run them with vitest

Options:
  --out-dir <dir>   write generated files into <dir> instead of next to the source
  --conjoin         evaluate a & b as one conjoined question instead of a * b
  -h, --help        show this message
`;

export type CliIo = {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  /** Runs the generated test files and returns an exit code. */
  runVitest?: (files: string[]) => number;
};

const defaultIo: CliIo = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  runVitest: runVitest,
};

function runVitest(files: string[]): number {
  const bin = fileURLToPath(new URL("../node_modules/.bin/vitest", import.meta.url));
  const result = spawnSync(bin, ["run", ...files], { stdio: "inherit" });
  if (result.error !== undefined) {
    process.stderr.write(`bel: could not run vitest (${result.error.message})\n`);
    return 1;
  }
  return result.status ?? 1;
}

/**
 * Load `.env` from the working directory, if there is one.
 *
 * A CLI reading `.env` is what people expect, and recording a cassette needs a
 * key in the environment. A library never does this: `@bel/runtime` reads the
 * environment it is given and nothing else.
 */
function loadEnvFile(): void {
  try {
    process.loadEnvFile();
  } catch {
    // No `.env`; the shell's environment is all there is.
  }
}

/** Run the command line. Returns the process exit code. */
export function main(argv: string[], io: CliIo = defaultIo): number {
  loadEnvFile();
  const args = argv.slice(2);
  if (args.length === 0) {
    io.stderr(USAGE);
    return 1;
  }
  if (args.includes("-h") || args.includes("--help")) {
    io.stdout(USAGE);
    return 0;
  }

  const [command, ...rest] = args;
  if (command !== "build" && command !== "test") {
    io.stderr(`bel: unknown command \`${command}\`\n\n${USAGE}`);
    return 1;
  }

  let outDir: string | null = null;
  let conjoin = false;
  const files: string[] = [];

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index] as string;
    if (arg === "--out-dir") {
      index += 1;
      const value = rest[index];
      if (value === undefined) {
        io.stderr("bel: --out-dir needs a directory\n");
        return 1;
      }
      outDir = value;
      continue;
    }
    if (arg === "--conjoin") {
      conjoin = true;
      continue;
    }
    if (arg.startsWith("-")) {
      io.stderr(`bel: unknown option \`${arg}\`\n\n${USAGE}`);
      return 1;
    }
    files.push(arg);
  }

  if (files.length === 0) {
    io.stderr(`bel: no input files\n\n${USAGE}`);
    return 1;
  }

  let failed = false;
  const generated: string[] = [];

  for (const file of files) {
    try {
      const source = readFileSync(file, "utf8");
      const strategy = conjoin ? { andStrategy: "conjoin" as const } : {};
      const code =
        command === "build"
          ? compile(source, strategy)
          : generateTests(parseBel(source), { source, fileName: file, ...strategy });
      if (code === null) {
        io.stderr(`bel: ${file} has no tests\n`);
        continue;
      }
      const suffix = command === "test" ? ".test.ts" : ".ts";
      const target =
        outDir === null ? `${file}${suffix}` : join(outDir, `${basename(file)}${suffix}`);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, code);
      io.stdout(`${file} -> ${target}\n`);
      generated.push(target);
    } catch (error) {
      failed = true;
      if (error instanceof BelError) io.stderr(`${error.format(file)}\n`);
      else io.stderr(`${file}: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }

  if (command === "test" && !failed && generated.length > 0) {
    const run = io.runVitest ?? defaultIo.runVitest;
    return run?.(generated) ?? 0;
  }

  return failed ? 1 : 0;
}
