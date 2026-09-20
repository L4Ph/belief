# bel

bel — a guard-driven language whose conditions are natural-language beliefs,
compiled to plain TypeScript.

This repository is a Vite+ / pnpm monorepo:

| Package             | Role                                                                          |
| ------------------- | ----------------------------------------------------------------------------- |
| `packages/compiler` | `@bel/compiler` — `.bel` source to TypeScript (dev dependency)                |
| `packages/runtime`  | `@bel/runtime` — `__bel` runtime, live Jev adapter (production dependency)    |
| `packages/testkit`  | `@bel/testkit` — mock / cassette / confidence-floor runtimes (dev dependency) |

## What it looks like

```
import { escalate, refund, reply, type Action, type Ticket } from "./actions.ts"

export flow support(t: Ticket): Action
  let urgency = score "how urgent is this?" in low | medium | high | human

  urgency >= high -> escalate(t)
  "the user asks for a refund" -> refund(t)
  _ -> reply("could you tell me more?")
```

```bash
bel build support.bel   # -> support.bel.ts, runnable TypeScript
bel test  support.bel   # -> support.bel.test.ts, run with Vitest
```

The emitted TypeScript is executed directly by Node, Deno or Bun (they strip
types); it is never compiled to JavaScript. A belief is a probability a model
answers, so a condition carries a threshold on its surface, and the questions a
flow will ask are known before it runs.

## Examples

| Example                                      | What it shows                                                                              |
| -------------------------------------------- | ------------------------------------------------------------------------------------------ |
| [`examples/support`](examples/support)       | beliefs combined with `&`, a `score` compared against a level, a threshold, a fallback     |
| [`examples/moderation`](examples/moderation) | a `choice` comparison, a high threshold, and a `confidence_floor` that changes the outcome |
| [`examples/triage`](examples/triage)         | nested guards, four destinations, still one call to the model                              |
| [`examples/leads`](examples/leads)           | a five-level rubric, and a recorded model answer replayed as a regression test             |

Each one commits the generated TypeScript next to its `.bel` source, so the
compiler's output is readable without running anything. A test in the compiler
package fails if the two drift apart.

```bash
cd examples/support
bel build support.bel   # regenerate support.bel.ts
bel test support.bel    # run the tests (mocked, no network)
node main.ts            # or ask the real model and print the trace
```

## Talking to the model

Copy `.env.example` to `.env` at the repository root and put a key in it. The
`bel` command reads the `.env` in the directory it runs from, and each example's
`main.ts` reads both the root's and its own. `@bel/runtime` itself reads
nothing: it uses the environment it is handed.

| Variable           | Meaning                                                        |
| ------------------ | -------------------------------------------------------------- |
| `TYPESAFE_API_KEY` | the key (`TYPE_SAFE_API_KEY` is accepted too)                  |
| `BEL_MODEL`        | the model, `jev-latest` by default                             |
| `BEL_API_URL`      | the endpoint, the TypeSafe service by default                  |
| `BEL_RECORD`       | set to `1` to record a `test.snapshot` instead of replaying it |

## Commands

```bash
vp install        # install workspace dependencies
vp check          # format, lint, type check
vp run -r test    # run every package's tests
vp run -r build   # build every package (vp pack)
```

The language specification lives in `docs/rfc/` (RFC 0001, `bel-v0`).
