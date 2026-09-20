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

## Commands

```bash
vp install        # install workspace dependencies
vp check          # format, lint, type check
vp run -r test    # run every package's tests
vp run -r build   # build every package (vp pack)
```

The language specification lives in `docs/rfc/` (RFC 0001, `bel-v0`).
