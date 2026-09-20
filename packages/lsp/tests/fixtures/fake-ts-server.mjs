// A language server that answers the three things the client forwards, so the
// client can be tested against a real process instead of a mock object.
import { Buffer } from "node:buffer";

const send = (message) => {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  process.stdout.write(
    Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii"), body]),
  );
};

let buffer = Buffer.alloc(0);
process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const end = buffer.indexOf("\r\n\r\n");
    if (end === -1) return;
    const length = Number(
      /Content-Length: (\d+)/i.exec(buffer.subarray(0, end).toString("ascii"))[1],
    );
    if (buffer.length < end + 4 + length) return;
    const message = JSON.parse(buffer.subarray(end + 4, end + 4 + length).toString("utf8"));
    buffer = buffer.subarray(end + 4 + length);
    handle(message);
  }
});

function handle(message) {
  if (message.method === "initialize") {
    send({ jsonrpc: "2.0", id: message.id, result: { capabilities: {} } });
    return;
  }
  if (message.method === "initialized") return;
  if (message.method === "textDocument/didOpen") {
    const uri = message.params.textDocument.uri;
    send({
      jsonrpc: "2.0",
      method: "textDocument/publishDiagnostics",
      params: {
        uri,
        diagnostics: [
          {
            range: { start: { line: 3, character: 0 }, end: { line: 3, character: 5 } },
            severity: 1,
            code: 2322,
            message: "from the TypeScript server",
          },
        ],
      },
    });
    return;
  }
  if (message.method === "textDocument/hover") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: { contents: { kind: "markdown", value: "from the TypeScript server" } },
    });
    return;
  }
  if (message.method === "workspace/configuration") {
    send({ jsonrpc: "2.0", id: message.id, result: [{}] });
    return;
  }
  if (message.id !== undefined) send({ jsonrpc: "2.0", id: message.id, result: null });
}
