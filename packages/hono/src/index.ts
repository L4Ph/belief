/**
 * The `route` target: a bel route table on Hono.
 *
 * The compiler emits the table; this package is the only place that knows
 * Hono. The decision is bel's: one `__bel.evaluate` asks about every
 * description at once, and the first route over its own threshold answers.
 * That is what makes a per-route `@ n` mean something, and what makes
 * `configureBel` — mocks, cassettes, a confidence floor — apply to routes
 * exactly as it does to flows.
 *
 * A description is matched by a middleware, not by a Hono router: the path
 * routes are registered first, so they answer without the model ever being
 * asked, and everything else goes through the one batched evaluation.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { __bel } from "@bel/runtime";

/** The variables the route middleware sets: `c.get("jev")` is the decision. */
export type BelEnv = { Variables: { jev: JevResult } };

export type BelContext = Context<BelEnv>;

export type BelHandler = (c: BelContext) => Response | Promise<Response>;

/** What the request was routed to, and how sure the model was. */
export type JevResult = {
  /** The matched description. `undefined` if no route reached its threshold. */
  route?: string;
  /** The probability of the matched route, or 0. */
  confidence: number;
  /** Description -> probability that the request matches it. They are independent. */
  probabilities: Record<string, number>;
};

/**
 * One line of a bel route table:
 *
 * - `description` is matched by meaning, and `threshold` is that route's `@ n`
 * - `path` is matched by Hono's own router and never asks the model
 * - `fallback` answers when no description reached its threshold
 */
export type BelRoute =
  | { description: string; threshold?: number; handler: BelHandler }
  | { path: string; handler: BelHandler }
  | { fallback: BelHandler };

export type BelOptions = {
  /** What a route without `@ n` has to reach. Default: 0.5 */
  threshold?: number;
  /**
   * Extra headers to redact, on top of the defaults (`authorization`, `cookie`,
   * `proxy-authorization`, `x-api-key`, `x-auth-token`). Those are always
   * redacted, so adding one cannot accidentally un-redact another.
   */
  redactHeaders?: string[];
  /** How much of a text body Jev sees. Default: 4096 */
  maxBodyLength?: number;
};

type DescribedRoute = { description: string; threshold?: number; handler: BelHandler };

const DEFAULT_THRESHOLD = 0.5;
const DEFAULT_MAX_BODY_LENGTH = 4096;
// Jev only needs to know these exist, not what they hold
const DEFAULT_REDACT_HEADERS = [
  "authorization",
  "cookie",
  "proxy-authorization",
  "x-api-key",
  "x-auth-token",
];

// text/*, */json, */xml, +json, +xml (e.g. image/svg+xml) and urlencoded forms.
// Not a bare `xml`: it would match application/vnd.openxmlformats-… (xlsx, docx)
const TEXT_CONTENT_TYPE = /^text\/|[/+](json|xml)\s*($|;)|^application\/x-www-form-urlencoded/i;

/**
 * The question a route asks about a request. It is phrased as a belief about
 * the request — not as "does this path match" — because a single request is
 * never "all requests", but it is one that a handler for "all requests"
 * should receive.
 */
export const routeQuestion = (description: string): string =>
  `A router has a handler for requests described as "${description}" (the description may be in any language). Is this HTTP request one that the handler should receive?`;

/** Build the app a bel route table describes. */
export function createApp(routes: BelRoute[], options: BelOptions = {}): Hono<BelEnv> {
  const described = routes.filter((route): route is DescribedRoute => "description" in route);
  const app = new Hono<BelEnv>();

  // Path routes first: for those, the middleware below never runs.
  for (const route of routes) {
    if ("path" in route) app.all(route.path, route.handler);
    else if ("fallback" in route) app.notFound(route.fallback);
  }

  if (described.length > 0) {
    const fallback = options.threshold ?? DEFAULT_THRESHOLD;
    app.use("*", async (c, next) => {
      const result = await decide(described, c, options, fallback);
      c.set("jev", result);
      const route = described.find((candidate) => candidate.description === result.route);
      if (route === undefined) return next();
      return route.handler(c);
    });
  }
  return app;
}

/** One call asks about every description; the first route over its threshold wins. */
async function decide(
  described: DescribedRoute[],
  c: BelContext,
  options: BelOptions,
  fallback: number,
): Promise<JevResult> {
  const evaluated = await __bel.evaluate(
    described.map((route, index) => ({
      id: `route_${index + 1}`,
      type: "noul" as const,
      text: routeQuestion(route.description),
    })),
    await state(c, options),
  );
  const probabilities: Record<string, number> = {};
  described.forEach((route, index) => {
    probabilities[route.description] = __bel.number(evaluated[index]);
  });
  const route = described.find(
    (candidate) => probabilities[candidate.description] >= (candidate.threshold ?? fallback),
  );
  return {
    route: route?.description,
    confidence: route === undefined ? 0 : probabilities[route.description],
    probabilities,
  };
}

/** The request as Jev sees it: redacted headers, and a text body capped in length. */
async function state(c: BelContext, options: BelOptions) {
  const redact = new Set(
    [...DEFAULT_REDACT_HEADERS, ...(options.redactHeaders ?? [])].map((name) => name.toLowerCase()),
  );
  const request = c.req.raw;
  const body =
    request.body === null
      ? undefined
      : await readBody(c, options.maxBodyLength ?? DEFAULT_MAX_BODY_LENGTH);
  return {
    method: request.method,
    url: request.url,
    headers: Object.fromEntries(
      [...request.headers].map(([name, value]) => [name, redact.has(name) ? "[redacted]" : value]),
    ),
    ...(body === undefined ? {} : { body }),
  };
}

/**
 * The body is cached as an ArrayBuffer, so a handler can still read it: Hono
 * derives text(), json(), formData() and blob() from it without loss.
 */
async function readBody(c: BelContext, maxLength: number): Promise<string> {
  const buffer = await c.req.arrayBuffer();
  const contentType = c.req.header("content-type") ?? "text/plain";
  if (!TEXT_CONTENT_TYPE.test(contentType)) {
    return `[${buffer.byteLength} bytes of ${contentType}]`;
  }
  return new TextDecoder().decode(buffer.slice(0, maxLength));
}
