/**
 * Serve the bel site and let Jev decide who is visiting.
 *
 *   vp run live
 *   curl -A 'Mozilla/5.0 (Macintosh)' -H 'Accept: text/html' http://localhost:8787/
 *   curl -H 'Accept: application/json' http://localhost:8787/metadata   # JSON
 *   curl -H 'Accept: text/html' http://localhost:8787/metadata          # 該当なし（fallback）
 *   curl -X POST -H 'Content-Type: text/plain' --data 'bel のインストール方法を教えてください' http://localhost:8787/
 *   curl -X POST -H 'Content-Type: text/plain' --data 'bel の言語仕様はどこにありますか' http://localhost:8787/
 *   curl http://localhost:8787/robots.txt    # a path route: no model is asked
 *
 * Node runs the whole thing: bel's output is erasable TypeScript, the pages
 * are hono/html templates, and `@bel/runtime` reads `TYPESAFE_API_KEY` from
 * the environment itself — which is what `--env-file` in package.json is for.
 */
import { serve } from "@hono/node-server";
import { createApp } from "@bel/hono";
import { routes } from "./site.bel.ts";

if (process.env.TYPESAFE_API_KEY === undefined) {
  console.warn(
    "TYPESAFE_API_KEY が未設定です。Jev への問い合わせは失敗します（.env.example 参照）。",
  );
}

const app = createApp(routes);
const port = Number(process.env.PORT ?? 8787);

serve({ fetch: app.fetch, port });

console.log(`bel のサイト: http://localhost:${port}`);
console.log("URL ではなくリクエストの中身でページが決まります（URL もモデルが見る信号の1つです）:");
for (const request of [
  `curl -A 'Mozilla/5.0 (Macintosh)' -H 'Accept: text/html' http://localhost:${port}/`,
  `curl -H 'Accept: application/json' http://localhost:${port}/metadata   # JSON`,
  `curl -H 'Accept: text/html' http://localhost:${port}/metadata          # 機械可読ではないので fallback`,
  `curl -X POST -H 'Content-Type: text/plain' --data 'bel のインストール方法を教えてください' http://localhost:${port}/   # URL は / のまま、本文で決まる`,
  `curl -X POST -H 'Content-Type: text/plain' --data 'bel の言語仕様はどこにありますか' http://localhost:${port}/      # 仕様ページ`,
  `curl http://localhost:${port}/robots.txt                               # パス route: モデルを呼びません`,
]) {
  console.log(`  ${request}`);
}
