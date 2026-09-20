# bel

bel — a guard-driven language whose conditions are natural-language beliefs,
compiled to plain TypeScript.

This repository is a Vite+ / pnpm monorepo:

| Package             | Role                                                                          |
| ------------------- | ----------------------------------------------------------------------------- |
| `packages/compiler` | `@bel/compiler` — `.bel` source to TypeScript (dev dependency)                |
| `packages/runtime`  | `@bel/runtime` — `__bel` runtime, live Jev adapter (production dependency)    |
| `packages/testkit`  | `@bel/testkit` — mock / cassette / confidence-floor runtimes (dev dependency) |

## Commands

```bash
vp install        # install workspace dependencies
vp check          # format, lint, type check
vp run -r test    # run every package's tests
vp run -r build   # build every package (vp pack)
```

The language specification lives in `docs/rfc/` (RFC 0001, `bel-v0`).
