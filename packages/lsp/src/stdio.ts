import type { Message } from "./protocol.ts";
import type { BelServer } from "./server.ts";

/** Frame a message the way the protocol asks: a length header, then JSON. */
export function frame(message: Message): string {
  const body = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`;
}

/**
 * Speak the protocol over a pair of streams.
 *
 * The reading is deliberately synchronous-per-chunk: a language server's
 * traffic is small, and a queue would be machinery without a purpose here.
 */
export function runStdio(
  server: BelServer,
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout,
): void {
  let buffer = Buffer.alloc(0);

  const drain = (): void => {
    for (;;) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      const header = buffer.subarray(0, headerEnd).toString("ascii");
      const length = /Content-Length: (\d+)/i.exec(header);
      if (length === null) {
        buffer = buffer.subarray(headerEnd + 4);
        continue;
      }
      const start = headerEnd + 4;
      const size = Number(length[1]);
      if (buffer.length < start + size) return;

      const body = buffer.subarray(start, start + size).toString("utf8");
      buffer = buffer.subarray(start + size);
      try {
        for (const message of server.handle(JSON.parse(body) as Message)) {
          output.write(frame(message));
        }
      } catch (error) {
        output.write(
          frame({
            jsonrpc: "2.0",
            method: "window/logMessage",
            params: {
              type: 1,
              message: `bel: ${error instanceof Error ? error.message : String(error)}`,
            },
          }),
        );
      }
    }
  };

  input.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    drain();
  });
}
