#!/usr/bin/env node
import { BelServer, pathOf } from "./server.ts";
import { runStdio } from "./stdio.ts";
import { findTypeScriptServer, TypeScriptClient } from "./typescript.ts";

const server = new BelServer({
  createTypescript: (rootUri, onDiagnostics) => {
    const found = findTypeScriptServer({
      workspace: rootUri === null ? null : pathOf(rootUri),
    });
    if (found === null) return null;
    return new TypeScriptClient({
      server: found,
      rootUri,
      onDiagnostics,
      onLog: (message) => {
        // A server that will not start is worth saying out loud: the editor
        // keeps working, and bel answers for what bel knows either way.
        process.stderr.write(`${message}\n`);
      },
    });
  },
});

runStdio(server);
