import type { Message } from "./protocol.ts";

/** Frame a message the way the protocol asks: a length header, then JSON. */
export function frame(message: Message): Buffer {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii"), body]);
}

/**
 * Read framed messages off a stream.
 *
 * Lengths are bytes, so the buffer stays a Buffer until a whole message is
 * there: mixing byte lengths with string lengths is how a server that speaks
 * Japanese gets confused. It did, once, in a test.
 */
export function createReader(onMessage: (message: Message) => void): {
  push: (chunk: Buffer) => void;
} {
  let buffer = Buffer.alloc(0);

  return {
    push(chunk: Buffer): void {
      buffer = Buffer.concat([buffer, chunk]);
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
        onMessage(JSON.parse(body) as Message);
      }
    },
  };
}
