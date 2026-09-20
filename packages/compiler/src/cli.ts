#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { BelError } from "./ast.ts";
import { compile } from "./compile.ts";

const USAGE = `bel — compile .bel source to TypeScript

Usage:
  bel build [options] <file.bel>...

Options:
  --out-dir <dir>   write generated files into <dir> instead of next to the source
  --conjoin         evaluate a & b as one conjoined question instead of a * b
  -h, --help        show this message

The generated file is <name>.bel.ts. Test and mock declarations are stripped.
`;

export type CliIo = {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
};

const defaultIo: CliIo = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
};

/** Run the command line. Returns the process exit code. */
export function main(argv: string[], io: CliIo = defaultIo): number {
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
  if (command !== "build") {
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
  for (const file of files) {
    try {
      const source = readFileSync(file, "utf8");
      const code = compile(source, conjoin ? { andStrategy: "conjoin" } : {});
      const target = outDir === null ? `${file}.ts` : join(outDir, `${basename(file)}.ts`);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, code);
      io.stdout(`${file} -> ${target}\n`);
    } catch (error) {
      failed = true;
      if (error instanceof BelError) io.stderr(`${error.format(file)}\n`);
      else io.stderr(`${file}: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }

  return failed ? 1 : 0;
}
