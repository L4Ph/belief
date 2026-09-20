import { expect, test } from "vite-plus/test";
import { belUriOf, BelServer, previewUriOf } from "../src/server.ts";
import { lineOffsetToPosition } from "../src/protocol.ts";
import { buildVirtualDocument, toVirtualOffset } from "../src/virtual.ts";
import type { Message } from "../src/protocol.ts";

const URI = "file:///support.bel";
const SOURCE = `import { reply, type Action, type Ticket } from "./actions.ts"

export flow support(t: Ticket): Action
  let urgency = score "how urgent?" in low | high

  urgency >= high -> reply("a")
  _ -> reply("b")
`;

type Call = { method: string; params: unknown };

function bridge() {
  const calls: Call[] = [];
  const opened: { uri: string; text: string }[] = [];
  return {
    calls,
    opened,
    start: () => {},
    open: (uri: string, text: string) => opened.push({ uri, text }),
    change: () => {},
    close: () => {},
    dispose: () => {},
    request: (method: string, params: unknown) => {
      calls.push({ method, params });
      return Promise.resolve({ contents: { kind: "markdown", value: "from TypeScript" } });
    },
  };
}

async function started(): Promise<{ server: BelServer; bridge: ReturnType<typeof bridge> }> {
  const fake = bridge();
  const server = new BelServer({ createTypescript: () => fake });
  await server.handle({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { rootUri: "file:///" },
  });
  return { server, bridge: fake };
}

async function open(server: BelServer, text: string): Promise<Message[]> {
  return server.handle({
    jsonrpc: "2.0",
    method: "textDocument/didOpen",
    params: { textDocument: { uri: URI, text } },
  });
}

function hoverAt(server: BelServer, offset: number, text: string): Promise<Message[]> {
  return server.handle({
    jsonrpc: "2.0",
    id: 9,
    method: "textDocument/hover",
    params: { textDocument: { uri: URI }, position: lineOffsetToPosition(text, offset) },
  });
}

test("the islands are handed over as a TypeScript file next to the source", async () => {
  const { server, bridge: fake } = await started();
  await open(server, SOURCE);
  expect(fake.opened).toHaveLength(1);
  expect(fake.opened[0]?.uri).toBe(previewUriOf(URI));
  expect(fake.opened[0]?.text).toContain(
    "export async function support(t: Ticket): Promise<Action> {",
  );
});

test("a position the islands own is answered by TypeScript", async () => {
  const { server, bridge: fake } = await started();
  await open(server, SOURCE);
  const inside = SOURCE.indexOf(`reply("a")`);
  const [response] = await hoverAt(server, inside, SOURCE);
  const hover = (response?.result as { contents: { value: string } } | undefined)?.contents.value;
  expect(hover).toBe("from TypeScript");

  const preview = buildVirtualDocument(SOURCE);
  if (preview === null) throw new Error("expected a preview");
  const virtual = toVirtualOffset(preview, inside);
  const hoverCall = fake.calls.find((call) => call.method === "textDocument/hover");
  expect(hoverCall?.params).toEqual({
    textDocument: { uri: previewUriOf(URI) },
    position: lineOffsetToPosition(preview.text, virtual as number),
  });
});

test("a position bel owns is never sent to TypeScript", async () => {
  const { server, bridge: fake } = await started();
  await open(server, SOURCE);
  const [response] = await hoverAt(server, SOURCE.indexOf("urgency >= high") + 3, SOURCE);
  const hover = (response?.result as { contents: { value: string } } | undefined)?.contents.value;
  expect(hover).toContain("let urgency: score<2>");
  expect(fake.calls.filter((call) => call.method === "textDocument/hover")).toHaveLength(0);
});

test("a guard condition, which is not TypeScript, is not sent either", async () => {
  const { server, bridge: fake } = await started();
  await open(server, SOURCE);
  const [response] = await hoverAt(server, SOURCE.indexOf(">= high"), SOURCE);
  expect(response?.result).toBeNull();
  expect(fake.calls.filter((call) => call.method === "textDocument/hover")).toHaveLength(0);
});

test("TypeScript diagnostics land on the bel file, in bel coordinates", async () => {
  const { server } = await started();
  await open(server, SOURCE);

  const preview = buildVirtualDocument(SOURCE);
  if (preview === null) throw new Error("expected a preview");
  const bel = SOURCE.indexOf(`reply("a")`);
  const virtual = toVirtualOffset(preview, bel);
  if (virtual === null) throw new Error("expected a mapping");

  server.receiveTypeScriptDiagnostics(previewUriOf(URI), [
    {
      range: {
        start: lineOffsetToPosition(preview.text, virtual),
        end: lineOffsetToPosition(preview.text, virtual + 5),
      },
      severity: 1,
      code: 2322,
      message: "Type 'Promise<Action>' is not assignable",
    },
    // A diagnostic about the synthetic wrapper has nowhere to point.
    {
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
      message: "wrapper",
    },
  ]);

  const messages = await server.handle({
    jsonrpc: "2.0",
    method: "textDocument/didChange",
    params: { textDocument: { uri: URI, version: 2 }, contentChanges: [{ text: SOURCE }] },
  });
  const params = messages[0]?.params as
    | { diagnostics: { message: string; source?: string }[] }
    | undefined;
  const diagnostics = params?.diagnostics ?? [];
  expect(diagnostics.map((d) => d.message)).toEqual(["Type 'Promise<Action>' is not assignable"]);
  expect(diagnostics[0]?.source).toBe("typescript");
});

test("the preview uri is what comes back from the server's own", () => {
  expect(belUriOf(previewUriOf(URI))).toBe(URI);
  expect(belUriOf("file:///other.ts")).toBeNull();
});
