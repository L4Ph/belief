/**
 * The pages, written with hono/html's tagged template.
 *
 * No JSX: a bel island is plain TypeScript that a type-stripping runtime
 * executes, so the views stay erasable too, and `node main.ts` runs the whole
 * site without a build step.
 *
 * Every page takes the routing decision, and the footer shows it: which
 * description won, and how sure Jev was about each of them.
 */
import { html, raw } from "hono/html";
import type { JevResult } from "@bel/hono";

/** `undefined` when a path route (or nothing) answered, so no model was asked. */
export type Asked = JevResult | undefined;

export type Page = ReturnType<typeof html>;

const SAMPLE = `import { escalate, refund, reply, type Action, type Ticket } from "./actions.ts"

export flow support(t: Ticket): Action
  let urgency = score "how urgent is this?" in low | medium | high | human

  urgency >= high -> escalate(t)
  "the user asks for a refund" @ 0.7 -> refund(t)
  _ -> reply("could you tell me more?")`;

const STYLE = `
  :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, sans-serif; }
  body { margin: 0 auto; max-width: 42rem; padding: 2rem 1.5rem; line-height: 1.7; }
  header { display: flex; justify-content: space-between; gap: 1rem; border-bottom: 1px solid; padding-bottom: .5rem; }
  nav a { margin-left: .75rem; }
  code, pre { font-family: ui-monospace, SFMono-Regular, monospace; font-size: .9em; }
  pre { background: color-mix(in oklab, currentColor 8%, transparent); padding: .75rem 1rem; overflow-x: auto; }
  main ul { padding-left: 1.25rem; }
  footer { border-top: 1px solid; margin-top: 3rem; padding-top: .5rem; font-size: .85em; }
  footer li { list-style: none; margin-left: -1.25rem; font-variant-numeric: tabular-nums; }
  a { color: inherit; }
`;

function layout(title: string, decision: Asked, children: Page): Page {
  return html`<!DOCTYPE html>
    <html lang="ja">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${title} — bel</title>
        <style>
          ${raw(STYLE)}
        </style>
      </head>
      <body>
        <header>
          <strong>bel</strong>
          <nav><a href="/">概要</a><a href="/install">インストール</a><a href="/spec">仕様</a></nav>
        </header>
        <main>${children}</main>
        <footer>
          ${
            decision === undefined
              ? html`<p>パス route が応答しました。モデルは呼ばれていません。</p>`
              : decisionBlock(decision)
          }
        </footer>
      </body>
    </html>`;
}

function decisionBlock(decision: JevResult): Page {
  return html`<details>
    <summary>
      jev はこのリクエストを「${decision.route}」に ${decision.confidence.toFixed(2)}
      の確度で送りました
    </summary>
    <p>以下の description はすべて1回の呼び出しで聞いています:</p>
    <ul>
      ${Object.entries(decision.probabilities).map(
        ([route, probability]) => html`<li>${probability.toFixed(2)} — ${route}</li>`,
      )}
    </ul>
  </details>`;
}

export function home(decision: Asked): Page {
  return layout(
    "概要",
    decision,
    html`
      <p>
        bel は「条件が自然言語の信念（確率）である」言語です。出力は素の TypeScript
        なので、型チェックもエディタもそのまま使えます。
      </p>
      <pre><code>${SAMPLE}</code></pre>
      <p>
        信念は確率なので、ガードはそれぞれ閾値を持ちます。フローがどの質問をするかは、実行前に静的に分かります。
      </p>
      <p>
        このサイト自体も例です。<code>site.bel</code> の <code>route "…"</code> は bel
        のランタイムが1回の Jev 呼び出しで判定し、閾値を超えた最初のページが表示されています。
      </p>
    `,
  );
}

export function install(decision: Asked): Page {
  return layout(
    "インストール",
    decision,
    html`
      <p>bel は Vite+ / pnpm のモノレポです。チェックアウトから:</p>
      <pre><code>${`vp install
vp run -r build
vp run examples      # examples/*/*.bel をコンパイル
vp run -r test`}</code></pre>
      <p>
        生成されたコードは Node / Deno / Bun が型を剥がして直接実行します。JavaScript
        は作りません（公開 JS は
        <code>@bel/runtime</code> だけです）。
      </p>
      <p>本物のモデルに聞くには <code>.env</code> に TypeSafe のキーが必要です:</p>
      <pre><code>${`cp .env.example .env   # TYPESAFE_API_KEY=…
bel build support.bel
node main.ts`}</code></pre>
    `,
  );
}

export function spec(decision: Asked): Page {
  return layout(
    "仕様",
    decision,
    html`
      <p>
        言語仕様は RFC 0001「bel-v0」: 信念・フロー・ガード・テストと、TypeScript
        へのコンパイル。実体は
        <code>docs/rfc/0001-bel-v0.md</code> にあります。
      </p>
      <p>
        <code>route</code> は RFC 0002 で、このサイトはそのスパイクです。判定は bel
        のランタイムが持ち、1回の Jev 呼び出しで全 description を聞いて、それぞれの
        <code>@ n</code> を超えた最初の route が答えます。
      </p>
    `,
  );
}

export function notFound(decision: Asked): Page {
  return layout(
    "該当なし",
    decision,
    html`
      <p>
        どの description も閾値を超えなかったので、fallback の
        <code>route _</code> がこのページを返しました。
      </p>
      <p>
        概要・インストール手順・仕様のどれかを尋ねてください。URL
        ではなく、リクエストの中身で決まります。
      </p>
    `,
  );
}
