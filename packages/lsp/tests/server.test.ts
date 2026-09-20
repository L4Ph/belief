import { expect, test } from "vite-plus/test";
import { BelServer } from "../src/server.ts";
import { frame } from "../src/stdio.ts";
import type { Message } from "../src/protocol.ts";

async function request(server: BelServer, message: Message): Promise<Message[]> {
  return server.handle(message);
}

function open(server: BelServer, text: string): Promise<Message[]> {
  return request(server, {
    jsonrpc: "2.0",
    method: "textDocument/didOpen",
    params: { textDocument: { uri: "file:///support.bel", text } },
  });
}

function diagnosticsOf(messages: Message[]): { code?: string; message: string; range: unknown }[] {
  const params = messages[0]?.params as { diagnostics: [] } | undefined;
  return params?.diagnostics ?? [];
}

const GOOD = `flow f(t: Ticket): Action
  let urgency = score "how urgent?" in low | high

  urgency >= high -> reply("a")
  _ -> reply("b")
`;

test("initialize advertises what the server can do", async () => {
  const [response] = await request(new BelServer(), {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
  });
  expect(response?.id).toBe(1);
  expect(response?.result).toMatchObject({
    capabilities: { textDocumentSync: 1, hoverProvider: true },
    serverInfo: { name: "bel" },
  });
});

test("a good document has no diagnostics", async () => {
  const server = new BelServer();
  expect(diagnosticsOf(await open(server, GOOD))).toEqual([]);
});

test("a compile error is published with its code and position", async () => {
  const server = new BelServer();
  const diagnostics = diagnosticsOf(
    await open(server, `flow f(t: Ticket): Action\n  "x" -> reply("a")\n`),
  );
  expect(diagnostics).toHaveLength(1);
  expect(diagnostics[0]?.code).toBe("missing-fallback");
  expect(diagnostics[0]?.range).toEqual({
    start: { line: 0, character: 0 },
    end: { line: 0, character: 25 },
  });
});

test("a syntax error is published too", async () => {
  const server = new BelServer();
  const diagnostics = diagnosticsOf(await open(server, `flow f(t: Ticket)\n  _ -> reply("b")\n`));
  expect(diagnostics[0]?.code).toBe("parse-error");
});

test("a test with no answers is caught while typing", async () => {
  const server = new BelServer();
  const diagnostics = diagnosticsOf(
    await open(
      server,
      `${GOOD}
test "a ticket"
  assert (await f(t)) is _
`,
    ),
  );
  expect(diagnostics[0]?.code).toBe("test-without-answers");
});

test("editing clears the diagnostic", async () => {
  const server = new BelServer();
  await open(server, `flow f(t: Ticket): Action\n  "x" -> reply("a")\n`);
  const messages = await request(server, {
    jsonrpc: "2.0",
    method: "textDocument/didChange",
    params: {
      textDocument: { uri: "file:///support.bel" },
      contentChanges: [{ text: GOOD }],
    },
  });
  expect(diagnosticsOf(messages)).toEqual([]);
});

test("closing clears the diagnostic", async () => {
  const server = new BelServer();
  await open(server, `flow f(t: Ticket): Action\n  "x" -> reply("a")\n`);
  const messages = await request(server, {
    jsonrpc: "2.0",
    method: "textDocument/didClose",
    params: { textDocument: { uri: "file:///support.bel" } },
  });
  expect(diagnosticsOf(messages)).toEqual([]);
});

test("hovering a binding shows what it asks", async () => {
  const server = new BelServer();
  await open(server, GOOD);
  const [response] = await request(server, {
    jsonrpc: "2.0",
    id: 2,
    method: "textDocument/hover",
    params: {
      textDocument: { uri: "file:///support.bel" },
      position: { line: 1, character: 8 },
    },
  });
  const contents = (response?.result as { contents: { value: string } })?.contents.value;
  expect(contents).toContain(`let urgency: score<2> = score "how urgent?" in low | high`);
  expect(contents).toContain("asks the model");
});

test("hovering a flow shows its signature", async () => {
  const server = new BelServer();
  await open(server, GOOD);
  const [response] = await request(server, {
    jsonrpc: "2.0",
    id: 3,
    method: "textDocument/hover",
    params: {
      textDocument: { uri: "file:///support.bel" },
      position: { line: 0, character: 6 },
    },
  });
  const contents = (response?.result as { contents: { value: string } } | undefined)?.contents
    .value;
  expect(contents).toContain("flow f(t: Ticket): Action");
});

test("completion after a comparison offers the levels", async () => {
  const server = new BelServer();
  await open(server, GOOD);
  const [response] = await request(server, {
    jsonrpc: "2.0",
    id: 4,
    method: "textDocument/completion",
    params: {
      textDocument: { uri: "file:///support.bel" },
      position: { line: 3, character: 16 },
    },
  });
  const result = response?.result as { items: { label: string; detail: string }[] } | undefined;
  const items = result?.items ?? [];
  expect(items.map((item) => item.label)).toEqual(["low", "high"]);
  expect(items[1]?.detail).toBe("level 1 of how urgent?");
});

test("completion elsewhere offers nothing", async () => {
  const server = new BelServer();
  await open(server, GOOD);
  const [response] = await request(server, {
    jsonrpc: "2.0",
    id: 5,
    method: "textDocument/completion",
    params: {
      textDocument: { uri: "file:///support.bel" },
      position: { line: 3, character: 2 },
    },
  });
  expect(response?.result).toBeNull();
});

test("messages are framed with a byte length, not a character count", () => {
  const message = { jsonrpc: "2.0" as const, id: 1, result: "urgent — 緊急" };
  const framed = frame(message).toString("utf8");
  const body = framed.slice(framed.indexOf("\r\n\r\n") + 4);
  expect(framed).toBe(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  expect(Buffer.byteLength(body)).toBeGreaterThan(body.length);
});

test("hovering a level explains which level it is", async () => {
  const server = new BelServer();
  await open(server, GOOD);
  const [response] = await request(server, {
    jsonrpc: "2.0",
    id: 6,
    method: "textDocument/hover",
    params: {
      textDocument: { uri: "file:///support.bel" },
      position: { line: 3, character: 14 },
    },
  });
  const contents = (response?.result as { contents: { value: string } } | undefined)?.contents
    .value;
  expect(contents).toContain("level 1 of 2");
});

test("hovering a question says what kind of question it is", async () => {
  const server = new BelServer();
  await open(server, GOOD);
  const [response] = await request(server, {
    jsonrpc: "2.0",
    id: 7,
    method: "textDocument/hover",
    params: {
      textDocument: { uri: "file:///support.bel" },
      position: { line: 1, character: 30 },
    },
  });
  const contents = (response?.result as { contents: { value: string } } | undefined)?.contents
    .value;
  expect(contents).toContain("levels: low → high");
});

test("a binding hover carries its bel type", async () => {
  const server = new BelServer();
  await open(server, GOOD);
  const [response] = await request(server, {
    jsonrpc: "2.0",
    id: 8,
    method: "textDocument/hover",
    params: {
      textDocument: { uri: "file:///support.bel" },
      position: { line: 1, character: 8 },
    },
  });
  const contents = (response?.result as { contents: { value: string } } | undefined)?.contents
    .value;
  expect(contents).toContain("let urgency: score<2>");
});
