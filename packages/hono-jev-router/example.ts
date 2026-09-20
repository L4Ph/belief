/**
 * A Hono app whose `jev` routes are matched by meaning, not by path.
 *
 *   vp run live                       # a refund
 *   vp run live POST /support "I cannot log in"
 *
 * Prints the response and the decision behind it: what Jev was asked, and how
 * sure it was. Everything the router does — thresholds, redaction, fallback —
 * is in ../../README.md and ../README.md.
 */
import { Hono } from "hono";
import { JevRouter, type JevResult } from "./src/index.ts";

const apiKey = process.env.TYPESAFE_API_KEY ?? process.env.TYPE_SAFE_API_KEY;
if (apiKey === undefined || apiKey === "") {
  throw new Error("TYPESAFE_API_KEY is not set: run this through `vp run live`.");
}

const [method = "PUT", path = "/billing/1234", ...words] = process.argv.slice(2);

const app = new Hono<{ Variables: { jev: JevResult } }>({
  // One call to Jev decides which of the `jev` routes below runs.
  router: new JevRouter({ apiKey }),
});

app.get("/health", (c) => c.text("ok"));

app.on("jev", "a customer asking for their money back", (c) => c.text("refund\n"));
app.on("jev", "a customer who cannot log in", (c) => c.text("login help\n"));
app.on("jev", "a request that lists everything the service can do", (c) =>
  c.text("GET /health\nPUT /billing/:id\nPOST /support\n"),
);

let decision: JevResult | undefined;
app.use(async (c, next) => {
  await next();
  decision = c.get("jev");
});

const response = await app.request(path, {
  method,
  headers: { "content-type": "application/json", "user-agent": "curl/8.7.1" },
  ...(method === "POST" ? { body: JSON.stringify({ message: words.join(" ") || "help" }) } : {}),
});

console.log(`${method} ${path} -> ${response.status}`);
console.log(await response.text());
if (decision === undefined) {
  console.log("no route was asked: a path route or the 404 handler answered.");
} else {
  console.log(`matched: ${decision.route ?? "(nothing reached the threshold)"}`);
  for (const [route, probability] of Object.entries(decision.probabilities)) {
    console.log(`  ${probability.toFixed(2)}  ${route}`);
  }
}
