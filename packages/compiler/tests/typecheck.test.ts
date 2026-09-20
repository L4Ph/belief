import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";
import { compile } from "../src/compile.ts";

const TSC = fileURLToPath(new URL("../node_modules/.bin/tsc", import.meta.url));
const RUNTIME = fileURLToPath(new URL("../../runtime/src/index.ts", import.meta.url));
const RUNTIME_TYPES = fileURLToPath(new URL("../../runtime/node_modules/@types", import.meta.url));

const BEL = `import { escalate, refund, reply, type Action, type Ticket } from "./actions.ts"

export flow support(t: Ticket): Action
  let urgency = score "how urgent is this?" in low | medium | high | human

  urgency >= high -> escalate(t)
  "the user is angry" & "the user asks for a refund" @ 0.7 -> refund(t)
  _ -> reply("could you tell me more?")
`;

const ACTIONS = `export type Ticket = { message: string }

export type Action =
  | { type: "Escalate"; args: [Ticket] }
  | { type: "Refund"; args: [] }
  | { type: "Reply"; args: [string] }

export async function escalate(t: Ticket): Promise<Action> {
  return { type: "Escalate", args: [t] }
}

export async function refund(t: Ticket): Promise<Action> {
  return { type: "Refund", args: [] }
}

export async function reply(message: string): Promise<Action> {
  return { type: "Reply", args: [message] }
}
`;

/**
 * The generated code has to satisfy `tsc` against the real runtime types and a
 * real action module. This is the check that the compiled output is a program
 * and not just text that looks like one.
 */
function typecheck(options: { andStrategy?: "mul" | "conjoin" } = {}): void {
  const dir = mkdtempSync(join(tmpdir(), "bel-typecheck-"));
  try {
    writeFileSync(join(dir, "actions.ts"), ACTIONS);
    writeFileSync(join(dir, "support.bel.ts"), compile(BEL, options));
    writeFileSync(
      join(dir, "tsconfig.json"),
      JSON.stringify(
        {
          compilerOptions: {
            target: "esnext",
            module: "nodenext",
            moduleResolution: "nodenext",
            strict: true,
            noEmit: true,
            allowImportingTsExtensions: true,
            skipLibCheck: true,
            types: ["node"],
            typeRoots: [RUNTIME_TYPES],
            paths: { "@bel/runtime": [RUNTIME] },
          },
          include: ["*.ts"],
        },
        null,
        2,
      ),
    );
    execFileSync(TSC, ["--project", dir], { stdio: "pipe" });
  } catch (error) {
    const stderr = (error as { stdout?: Buffer }).stdout?.toString() ?? "";
    throw new Error(`tsc rejected the generated code:\n${stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("generated code type checks against the runtime and its actions", () => {
  expect(() => typecheck()).not.toThrow();
});

test("the conjoin strategy type checks too", () => {
  expect(() => typecheck({ andStrategy: "conjoin" })).not.toThrow();
});
