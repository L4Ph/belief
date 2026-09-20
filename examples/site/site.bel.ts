// @generated from bel source. Do not edit.
import type { BelRoute } from "@bel/hono";

import { home, install, spec, notFound } from "./views.ts"

export const routes: BelRoute[] = [
  { description: "bel のインストール方法や動かし方を知りたい人", handler: async (c) => c.html(install(c.get("jev"))) },
  { description: "言語仕様や RFC を探している人", handler: async (c) => c.html(spec(c.get("jev"))) },
  { description: "機械可読なサイト情報を求めるクライアント", handler: async (c) => c.json({ name: "bel", spec: "docs/rfc/0001-bel-v0.md" }) },
  { description: "特に用事がなくトップページを見に来た人", handler: async (c) => c.html(home(c.get("jev"))) },
  { path: "/robots.txt", handler: async (c) => c.text("User-agent: *\nAllow: /\n") },
  { fallback: async (c) => c.html(notFound(c.get("jev")), 404) },
];
