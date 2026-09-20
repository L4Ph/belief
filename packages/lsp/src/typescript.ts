import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { createReader, frame } from "./framing.ts";
import type { Message } from "./protocol.ts";

export type TypeScriptServer = { command: string; args: string[]; name: string };

/**
 * Find a TypeScript language server to answer for the islands.
 *
 * `BEL_TS_SERVER` wins, because the honest answer for a published extension is
 * to install its own copy and this is not that yet. Otherwise a server on the
 * path, then the ones Zed keeps for its own TypeScript support. Nothing found
 * is not an error: bel's own features do not need one.
 */
export function findTypeScriptServer(
  options: {
    env?: NodeJS.ProcessEnv;
    which?: (name: string) => string | null;
    exists?: (path: string) => boolean;
    readFile?: (path: string) => string;
    /** Where Zed keeps its own tooling. `null` says it is not there. */
    supportDir?: string | null;
    /** The workspace, so its own TypeScript can be preferred. */
    workspace?: string | null;
    platform?: string;
    arch?: string;
  } = {},
): TypeScriptServer | null {
  const env = options.env ?? process.env;
  const which = options.which ?? whichOnPath;
  const exists = options.exists ?? existsSync;
  const readFile = options.readFile ?? ((path: string) => readFileSync(path, "utf8"));
  const workspace = options.workspace ?? null;
  const supportDir =
    options.supportDir ??
    (env["HOME"] === undefined ? null : join(env["HOME"], "Library/Application Support/Zed"));

  const explicit = env["BEL_TS_SERVER"];
  if (explicit !== undefined && explicit !== "" && exists(explicit)) {
    return { command: explicit, args: [], name: "BEL_TS_SERVER" };
  }

  // The project's own TypeScript, if it is the native one: the same compiler
  // the project builds with is the one that should answer for its code.
  const local = workspaceCompiler(workspace, { exists, readFile });
  if (local !== null) return local;

  // `typescript-language-server` drives the JavaScript tsserver, which no
  // longer exists in TypeScript 7. Offering it to a 7 project would only
  // produce a server that refuses to start.
  const legacy = workspaceUsesLegacyTypescript(workspace, { exists, readFile });
  if (legacy) {
    const onPath = which("typescript-language-server");
    if (onPath !== null) {
      return { command: onPath, args: ["--stdio"], name: "typescript-language-server" };
    }
  }

  // Zed ships one of these for its own TypeScript support.
  if (supportDir !== null) {
    const platform = options.platform ?? process.platform;
    const arch = options.arch ?? process.arch;
    const bundled = join(
      supportDir,
      `extensions/work/tsgo/node_modules/@typescript/typescript-${platform}-${arch}/lib/tsc`,
    );
    if (exists(bundled)) {
      return { command: bundled, args: ["--lsp", "--stdio"], name: "tsgo" };
    }
    const vtsls = join(
      supportDir,
      "languages/vtsls/node_modules/@vtsls/language-server/bin/vtsls.js",
    );
    if (exists(vtsls)) {
      return { command: process.execPath, args: [vtsls, "--stdio"], name: "vtsls" };
    }
  }

  return null;
}

/**
 * Whether the JavaScript server can serve this workspace: it can when the
 * TypeScript there is older than 7, or when there is none to contradict it.
 */
function workspaceUsesLegacyTypescript(
  workspace: string | null,
  io: { exists: (path: string) => boolean; readFile: (path: string) => string },
): boolean {
  const version = workspaceVersion(workspace, io);
  return version === null || Number.parseInt(version, 10) < 7;
}

function workspaceVersion(
  workspace: string | null,
  io: { exists: (path: string) => boolean; readFile: (path: string) => string },
): string | null {
  if (workspace === null) return null;
  let directory = workspace;
  for (;;) {
    const manifest = join(directory, "node_modules/typescript/package.json");
    if (io.exists(manifest)) {
      try {
        return /"version":\s*"([^"]+)"/.exec(io.readFile(manifest))?.[1] ?? null;
      } catch {
        return null;
      }
    }
    const parent = dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

/**
 * `tsc --lsp` is the native compiler in server mode, and it only exists in
 * TypeScript 7 and later. An older TypeScript is left to
 * `typescript-language-server`, which drives the JavaScript one.
 */
function workspaceCompiler(
  workspace: string | null,
  io: { exists: (path: string) => boolean; readFile: (path: string) => string },
): TypeScriptServer | null {
  if (workspace === null) return null;
  let directory = workspace;
  for (;;) {
    const binary = join(directory, "node_modules/.bin/tsc");
    const manifest = join(directory, "node_modules/typescript/package.json");
    if (io.exists(binary) && io.exists(manifest)) {
      let version: string | null = null;
      try {
        version = /"version":\s*"([^"]+)"/.exec(io.readFile(manifest))?.[1] ?? null;
      } catch {
        version = null;
      }
      if (version !== null && Number.parseInt(version, 10) >= 7) {
        return { command: binary, args: ["--lsp", "--stdio"], name: `tsc ${version}` };
      }
      return null;
    }
    const parent = dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

/** The first `name` in `PATH` that exists and is executable. */
export function whichOnPath(name: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const path = env["PATH"];
  if (path === undefined) return null;
  for (const directory of path.split(delimiter)) {
    if (directory === "") continue;
    const candidate = join(directory, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export type TypeScriptClientOptions = {
  server: TypeScriptServer;
  /** Where the workspace is, so the server can find a tsconfig. */
  rootUri: string | null;
  /** Diagnostics for a document, in the server's own coordinates. */
  onDiagnostics: (uri: string, diagnostics: unknown[]) => void;
  onLog?: (message: string) => void;
};

/**
 * A client for a TypeScript language server, mostly a pipe.
 *
 * Only the documents bel hands it exist to the far side: the virtual files.
 * Which means a TypeScript server never sees a `.bel` path, and never has an
 * opinion about one.
 */
export class TypeScriptClient {
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private child: ReturnType<typeof spawn> | null = null;
  private nextId = 1;
  private disposed = false;
  /** Everything waits for the handshake: a server told about a file before it
   *  is initialized answers `ServerNotInitialized`, and that is what a real
   *  server did before this queue existed. */
  private ready = false;
  private readonly queued: Message[] = [];
  private readonly handshake: Promise<void>;
  private readonly options: TypeScriptClientOptions;

  constructor(options: TypeScriptClientOptions) {
    this.options = options;
    this.handshake = new Promise((resolve) => {
      this.markReady = resolve;
    });
  }

  private markReady: () => void = () => {};

  get running(): boolean {
    return this.child !== null && !this.disposed;
  }

  get name(): string {
    return this.options.server.name;
  }

  start(): void {
    const { command, args } = this.options.server;
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    this.child = child;

    const reader = createReader((message) => this.receive(message));
    child.stdout?.on("data", (chunk: Buffer) => reader.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => {
      this.options.onLog?.(`${this.options.server.name}: ${chunk.toString("utf8").trim()}`);
    });
    child.on("exit", () => {
      this.child = null;
      for (const [, request] of this.pending)
        request.reject(new Error("the TypeScript server exited"));
      this.pending.clear();
    });

    void this.handshakeRequest("initialize", {
      processId: process.pid,
      rootUri: this.options.rootUri,
      capabilities: {
        textDocument: {
          hover: { contentFormat: ["markdown", "plaintext"] },
          definition: {},
          completion: { completionItem: { snippetSupport: false } },
        },
        workspace: { configuration: true, didChangeConfiguration: { dynamicRegistration: false } },
      },
      workspaceFolders:
        this.options.rootUri === null ? null : [{ uri: this.options.rootUri, name: "workspace" }],
    })
      .then(() => {
        this.ready = true;
        this.write({ jsonrpc: "2.0", method: "initialized", params: {} });
        for (const message of this.queued) this.write(message);
        this.queued.length = 0;
        this.markReady();
      })
      .catch((error: unknown) => {
        this.options.onLog?.(`${this.options.server.name}: ${String(error)}`);
        this.markReady();
      });
  }

  open(uri: string, text: string): void {
    this.notify("textDocument/didOpen", {
      textDocument: { uri, languageId: "typescript", version: 1, text },
    });
  }

  change(uri: string, text: string, version: number): void {
    this.notify("textDocument/didChange", {
      textDocument: { uri, version },
      contentChanges: [{ text }],
    });
  }

  close(uri: string): void {
    this.notify("textDocument/didClose", { textDocument: { uri } });
  }

  request(method: string, params: unknown): Promise<unknown> {
    return this.handshake.then(() => this.handshakeRequest(method, params));
  }

  notify(method: string, params: unknown): void {
    const message: Message = { jsonrpc: "2.0", method, params };
    if (this.ready) this.write(message);
    else this.queued.push(message);
  }

  /** What this client sends and receives, when someone is listening. */
  private trace(direction: "->" | "<-", message: Message): void {
    if (this.options.onLog === undefined || process.env["BEL_LSP_DEBUG"] !== "1") return;
    const label = message.method ?? `response ${message.id}`;
    this.options.onLog?.(
      `${direction} ${label} ${JSON.stringify(message.params ?? message.result ?? null).slice(0, 160)}`,
    );
  }

  /** A request that does not wait for the handshake, which is the handshake. */
  private handshakeRequest(method: string, params: unknown): Promise<unknown> {
    const child = this.child;
    if (child === null) return Promise.resolve(null);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      child.stdin?.write(frame({ jsonrpc: "2.0", id, method, params }));
    });
  }

  private write(message: Message): void {
    this.trace("->", message);
    this.child?.stdin?.write(frame(message));
  }

  dispose(): void {
    this.disposed = true;
    this.child?.kill();
    this.child = null;
  }

  private receive(message: Message): void {
    this.trace("<-", message);
    if (message.method !== undefined) {
      // A request from the server has to be answered, or it waits forever:
      // the first real server stopped here with a cancelled registration.
      const wantsAnswer = message.id !== undefined && message.id !== null;
      if (message.method === "textDocument/publishDiagnostics") {
        const params = message.params as { uri?: string; diagnostics?: unknown[] } | undefined;
        if (params?.uri !== undefined)
          this.options.onDiagnostics(params.uri, params.diagnostics ?? []);
        return;
      }
      if (message.method === "window/logMessage" || message.method === "window/showMessage") {
        const params = message.params as { message?: string } | undefined;
        if (params?.message !== undefined) {
          this.options.onLog?.(`${this.options.server.name}: ${params.message}`);
        }
        return;
      }
      if (message.method === "workspace/configuration") {
        const items = (message.params as { items?: unknown[] } | undefined)?.items ?? [];
        this.write({ jsonrpc: "2.0", id: message.id ?? null, result: items.map(() => ({})) });
        return;
      }
      if (wantsAnswer) this.write({ jsonrpc: "2.0", id: message.id ?? null, result: null });
      return;
    }

    if (message.id === undefined || message.id === null) return;
    const request = this.pending.get(Number(message.id));
    if (request === undefined) return;
    this.pending.delete(Number(message.id));
    if (message.error !== undefined) request.reject(new Error(message.error.message));
    else request.resolve(message.result ?? null);
  }
}
