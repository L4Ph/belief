import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";
import { createReader, frame } from "../src/framing.ts";
import { findTypeScriptServer, TypeScriptClient } from "../src/typescript.ts";
import type { Message } from "../src/protocol.ts";

const FAKE = fileURLToPath(new URL("fixtures/fake-ts-server.mjs", import.meta.url));

test("a reader reassembles what a framer wrote, byte length and all", () => {
  const seen: Message[] = [];
  const reader = createReader((message) => seen.push(message));
  const whole = frame({ jsonrpc: "2.0", id: 1, result: "urgent — 緊急" });
  // Delivered in pieces, the way a pipe does.
  reader.push(whole.subarray(0, 10));
  reader.push(whole.subarray(10, 40));
  reader.push(whole.subarray(40));
  expect(seen).toHaveLength(1);
  expect(seen[0]?.result).toBe("urgent — 緊急");
});

test("the environment can name the server", () => {
  const found = findTypeScriptServer({
    env: { BEL_TS_SERVER: "/opt/ts-server" },
    exists: (path) => path === "/opt/ts-server",
  });
  expect(found).toEqual({ command: "/opt/ts-server", args: [], name: "BEL_TS_SERVER" });
});

test("the project's own TypeScript is preferred when it is the native one", () => {
  const found = findTypeScriptServer({
    env: {},
    workspace: "/project",
    exists: () => true,
    readFile: () => '{"version": "7.0.2"}',
    which: () => "/usr/bin/tsserver-lsp",
    supportDir: null,
  });
  expect(found).toMatchObject({
    command: "/project/node_modules/.bin/tsc",
    args: ["--lsp", "--stdio"],
    name: "tsc 7.0.2",
  });
});

test("an older TypeScript is left to the JavaScript language server", () => {
  const found = findTypeScriptServer({
    env: {},
    workspace: "/project",
    // The compiler binary is absent; the manifest says which TypeScript it is.
    exists: (path) => path.endsWith("typescript/package.json"),
    readFile: () => '{"version": "5.6.3"}',
    which: () => "/usr/bin/tsserver-lsp",
    supportDir: null,
  });
  expect(found).toMatchObject({ command: "/usr/bin/tsserver-lsp", args: ["--stdio"] });
});

test("a TypeScript 7 workspace is not offered the JavaScript server", () => {
  const found = findTypeScriptServer({
    env: {},
    workspace: "/project",
    exists: (path) => path.endsWith("typescript/package.json"),
    readFile: () => '{"version": "7.0.2"}',
    which: () => "/usr/bin/tsserver-lsp",
    supportDir: null,
  });
  expect(found).toBeNull();
});

test("a server on the path is used when the workspace has none", () => {
  const found = findTypeScriptServer({
    env: {},
    which: (name) => (name === "typescript-language-server" ? "/usr/bin/tsserver-lsp" : null),
    exists: () => false,
    supportDir: null,
  });
  expect(found).toMatchObject({ command: "/usr/bin/tsserver-lsp", args: ["--stdio"] });
});

test("Zed's bundled compiler is used when nothing else is there", () => {
  const found = findTypeScriptServer({
    env: {},
    which: () => null,
    exists: (path) => path.endsWith("lib/tsc"),
    supportDir: "/support",
    platform: "darwin",
    arch: "arm64",
  });
  expect(found).toMatchObject({
    name: "tsgo",
    args: ["--lsp", "--stdio"],
    command:
      "/support/extensions/work/tsgo/node_modules/@typescript/typescript-darwin-arm64/lib/tsc",
  });
});

test("no server is not an error", () => {
  expect(
    findTypeScriptServer({ env: {}, which: () => null, exists: () => false, supportDir: null }),
  ).toBeNull();
});

test("the client talks to a real process", async () => {
  const diagnostics: { uri: string; diagnostics: unknown[] }[] = [];
  const client = new TypeScriptClient({
    server: { command: process.execPath, args: [FAKE], name: "fake" },
    rootUri: null,
    onDiagnostics: (uri, found) => diagnostics.push({ uri, diagnostics: found }),
  });
  client.start();
  client.open("file:///support.bel.preview.ts", "const x = 1;");

  await new Promise((resolve) => setTimeout(resolve, 400));
  expect(diagnostics).toHaveLength(1);
  expect(diagnostics[0]?.uri).toBe("file:///support.bel.preview.ts");

  const hover = await client.request("textDocument/hover", {
    textDocument: { uri: "file:///support.bel.preview.ts" },
    position: { line: 0, character: 0 },
  });
  expect(hover).toMatchObject({ contents: { value: "from the TypeScript server" } });
  client.dispose();
});
