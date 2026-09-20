import { createReader, frame } from "./framing.ts";
import type { BelServer } from "./server.ts";

export { frame } from "./framing.ts";

/**
 * Speak the protocol over a pair of streams.
 *
 * Messages are handled one at a time, in order: a request now waits on the
 * TypeScript server behind it, and replies must come back in the order the
 * editor asked for them.
 */
export function runStdio(
  server: BelServer,
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout,
): void {
  let queue: Promise<void> = Promise.resolve();
  server.onMessage = (message) => output.write(frame(message));

  const reader = createReader((message) => {
    queue = queue.then(async () => {
      try {
        for (const reply of await server.handle(message)) output.write(frame(reply));
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
    });
  });

  input.on("data", (chunk: Buffer) => reader.push(chunk));
}
