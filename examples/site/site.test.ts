import { afterEach, expect, test } from "vite-plus/test";
import { configureBel, resetBel } from "@bel/runtime";
import { createMockRuntime } from "@bel/testkit";
import { createApp, routeQuestion, type BelRoute } from "@bel/hono";
import { routes } from "./site.bel.ts";

afterEach(() => resetBel());

const described = routes.filter(
  (route): route is Extract<BelRoute, { description: string }> => "description" in route,
);

/**
 * Stands in for the model: one call asks about every description, so the mock
 * table covers all of them and `boosted` is the one that wins. This is the
 * same `configureBel` a bel flow's test uses — routes are decided by the bel
 * runtime, not by a router library.
 */
function site(boosted: string, value = 0.93) {
  configureBel(
    createMockRuntime(
      Object.fromEntries(
        described.map((route) => [
          routeQuestion(route.description),
          route.description.includes(boosted) ? value : 0.01,
        ]),
      ),
    ),
  );
  return createApp(routes);
}

test("インストールを尋ねるリクエストにはインストールページが返る", async () => {
  const response = await site("インストール").request("/", {
    headers: { "User-Agent": "curl/8.7.1" },
  });
  expect(response.status).toBe(200);
  const html = await response.text();
  expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
  expect(html).toContain("<title>インストール — bel</title>");
  // ページはどの決定で来たかを表示する（整形が行を折るので空白は許す）
  expect(html).toMatch(/0\.93\s+の確度/);
});

test("機械可読な情報を求めるクライアントには JSON が返る", async () => {
  const response = await site("機械可読").request("/metadata", {
    headers: { Accept: "application/json" },
  });
  expect(response.headers.get("content-type")).toContain("application/json");
  expect(await response.json()).toEqual({ name: "bel", spec: "docs/rfc/0001-bel-v0.md" });
});

test("パス route はモデルに聞かずに応答する", async () => {
  configureBel({
    evaluate: async () => {
      throw new Error("a path route must not ask the model");
    },
  });
  expect(await (await createApp(routes).request("/robots.txt")).text()).toBe(
    "User-agent: *\nAllow: /\n",
  );
});

test("閾値を超えなければ fallback ページが返る", async () => {
  const response = await site("だれも該当しない", 0.01).request("/anything");
  expect(response.status).toBe(404);
  expect(await response.text()).toContain("<title>該当なし — bel</title>");
});
