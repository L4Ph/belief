# bel 言語仕様 v0(ドラフト)

> **bel** — belief を第一級値に持つ、ガード駆動の AltTS 言語。
> 条件式が自然言語であり、その評価は TypeSafe Jev(Noul / Score / Choice)に委譲される。
> コンパイル先はプレーンな TypeScript。型検査・エディタ・エコシステムは tsc に乗る。

## 0. 設計原則

1. **belief 層と action 層の分離**。分岐条件はすべて belief(確率値)。副作用を持つ処理はすべて action(ただの TS 式)。
2. **意味論の追加は 1 つだけ**:「条件位置の文字列リテラルは belief として評価される」。それ以外は TS の意味論を変えない。
3. **曖昧さを隠蔽しない**。belief は 0–1 の実数であり、閾値・confidence は言語の表面に出す。
4. **テストは言語組み込み**。モデル呼び出しの差し替え(mock / cassette / confidence floor)は文法レベルの機能。

---

## 1. ファイルとモジュール

- 拡張子:`.bel`
- 1 ファイル = 1 モジュール。`import` / `export` は TS と同じ構文・意味。
- トップレベルには `flow` 定義、`type` / `interface` / `import` / `export`、belief の `let` 束縛のみ書ける。

```bel
import { kb, refund, escalate, reply } from "./actions"

type Ticket = {
  message: string
  purchaseDate: Date
}
```

## 2. 型

| 型         | 意味                  | 値域                    |
| ---------- | --------------------- | ----------------------- |
| `belief`   | 陳述のモデル評価結果  | 0.0 – 1.0(実数)         |
| `score<N>` | rubric による採点     | 0 – N-1(整数、順序付き) |
| その他     | TS の型をそのまま使用 | —                       |

- `belief` は数値ではない。算術演算は不可(`b1 + b2` はコンパイルエラー)。合成は `&` `|` `~` のみ。
- `belief` と数値の比較(`belief @ 0.7`、`belief > 0.8`)のみ許可。

## 3. 文法(BNF:belief 層)

```bnf
<program>      ::= <toplevel>*

<toplevel>     ::= <import-decl> | <type-decl> | <belief-let> | <flow-decl> | <route-decl> | <test-decl>

<belief-let>   ::= "let" <ident> "=" <belief-expr>

<flow-decl>    ::= "flow" <ident> "(" <params> ")" [ ":" <type> ] <guard-list>

<guard-list>   ::= <guard>+

<guard>        ::= <belief-expr> [ "@" <number> ] "->" <action>
                |  "_" "->" <action>                       ; catch-all(必須・最後)

<belief-expr>  ::= <belief-expr> "&" <belief-expr>         ; 論理積(独立評価の合成)
                |  <belief-expr> "|" <belief-expr>         ; 論理和
                |  "~" <belief-expr>                       ; 否定  (1 - p)
                |  "(" <belief-expr> ")"
                |  <string-literal>                        ; ★ belief リテラル
                |  <ident>                                 ; let 束縛した belief の参照

<action>       ::= <ts-block>                              ; TS の式文・ブロック(§6)
                |  <guard-list>                            ; ネストしたガード

<test-decl>    ::= <mock-decl> | <test-block>              ; §7

<number>       ::= 0.0 – 1.0 の実数
```

### 3.1 ガードのセマンティクス

- ガードは**上から順に評価**され、最初に閾値を超えたブロックのみ実行される(フォールスルーなし)。
- `@ n` を省略した場合のデフォルト閾値は **0.5**。
- 末尾の `_ ->` は catch-all。省略した場合、全ガード不成立時に `undefined` を返す(戻り値型がそれを許す場合のみコンパイル可)。
- コンパイラ警告:
  - `unreachable-guard`: catch-all より後のガード、恒真 belief の後のガード
  - `missing-fallback`: 戻り値型が `undefined` を含まないのに `_` がない

### 3.2 belief 演算子の意味

| 式       | 意味           | 評価                                                    |
| -------- | -------------- | ------------------------------------------------------- |
| `a & b`  | 両者の合成確率 | `a * b`(独立仮想) ※API 上は各々独立評価、合成はコード側 |
| `a \| b` | いずれか       | `a + b - a*b`                                           |
| `~a`     | 否定           | `1 - a`                                                 |

短絡評価は**しない**。belief の評価はプリフライトで一括化されるため(§5)、`&` の左が偽でも右は評価済み。副作用は belief 層に存在しないためこれは安全。

## 4. Score / Choice

rubric 採点は belief リテラルでは書けず、専用構文を持つ:

```bel
urgency = score "対応の緊急度" in 低 | 中 | 高 | 人間へ

flow support(t: Ticket): Action
  "ユーザーは怒っている" ->
    escalate(t) if urgency >= 高
```

- `score "..." in A | B | C` は `score<3>` 型の値を返す式。rubric の選択肢に序数がつく(先頭が 0)。
- 比較は選択肢名でも数値でも可(`urgency >= 高` ≡ `urgency >= 2`)。
- `choice "..." in A | B | C` は「最確の選択肢」を文字列リテラル型の union で返す。確率分布が欲しい場合は `choice.dist` を参照(型: `Record<A|B|C, number>`)。

## 5. コンパイルモデル

### 5.1 プリフライト評価(デフォルト)

flow 内の全 belief / score / choice をコンパイラが収集し、**エントリ時に 1 回のバッチ API コール**へまとめる:

```ts
// 出力イメージ(簡略)
export async function support(t: Ticket): Promise<Action> {
  const $b = await __bel.evaluate(
    [
      { id: 0, type: "noul", q: "ユーザーは怒っている" },
      { id: 1, type: "noul", q: "返金を要求している" },
      { id: 2, type: "score", q: "対応の緊急度", rubric: ["低", "中", "高", "人間へ"] },
    ],
    t,
  );
  if ($b[0].value >= 0.5) {
    if ($b[2].value >= 2) return escalate(t);
  }
  if ($b[1].value >= 0.5) return refund(t);
  return reply("もう少し詳しく教えてください");
}
```

- Jev の「質問は並列・独立・追加しても遅くならない」性質の直訳。
- ガード評価は O(1) API コール。ネストガード内の belief は外側が真の場合のみ必要 → **遅延評価にフォールバック**(2 段目以降は必要時に個別バッチ)。
- 同一文字列リテラルは重複排除される。

### 5.2 トレース

全評価はランタイムのトレースバッファに記録される:

```ts
type Trace = {
  flow: string;
  evaluations: { id: number; question: string; value: number; confidence: number }[];
  takenGuard: number;
};
```

デバッガ・可視化デモ・cassette 録画(§7)はすべてこれを読む。

## 6. action 層(TS の島)

- `->` の右辺および `flow` 外の通常コードは **そのまま TS**。コンパイラは島部分を oxc でパースし、AST をそのまま出力 TS に移植する。
- action 内で belief を**新規に**作ることはできない(文字列はただの string)。belief はガード位置と `let` 束縛でのみ誕生する。→「どこでモデルを呼ぶか」が静的に列挙可能になるのがプリフライトの前提。

## 7. テスト(言語組み込み)

```bel
mock beliefs
  "ユーザーは怒っている" => 0.9
  "返金を要求している" => 1.0
  "購入から14日以内である" => 0.0

test "期限切れ返金はポリシー説明に流れる"
  action = support(fakeTicket)
  assert action is Explain("返金期限切れ")

test "不確かな判断は人間へ"
  with confidence_floor 0.6
    assert support(ambiguousTicket) is Escalate(_)

test.snapshot "本番挙動の回帰"
  record "cassettes/support.v1.json"
```

3 段階:

1. **`mock beliefs`** — 文字列リテラルをキーに belief を定数化。分岐ロジックを完全に決定論的にテスト。mock に無い belief が評価されると**テスト失敗**(問い合わせ漏れ検出)。
2. **`test.snapshot ... record`** — 実 API の応答を cassette(JSON)に記録。CI では再生モードで走り、モデル判断の回帰を検出する(VCR 方式)。
3. **`with confidence_floor n`** — 指定ブロック内で confidence < n の評価を「不成立」として扱う。「自信のない時の挙動」のテスト。

テストは vitest 相当の TS へコンパイルされ、`mock beliefs` はランタイムへの DI 設定に落ちる。

## 8. ランタイム API(生成コードが依存する最小集合)

```ts
interface BelRuntime {
  evaluate(questions: Question[], state: unknown): Promise<Evaluation[]>;
  trace(t: Trace): void;
}
type Evaluation = { id: number; value: number; confidence: number };
```

デフォルト実装は Jev クライアント。テスト時は mock/cassette 実装に差し替わる。

## 9. Non-goals(v0 ではやらない)

- belief のループ内評価(state が変化し続ける再評価)は v0 では明示的な再呼び出しのみ。
- 既存 TS ファイルのスーパーセット宣言はしない(§Civet 参照:意味論を変えるため)。
- belief の確率較正(calibration)の保証はモデル側の責任とし、言語は関与しない。
- **belief / route はセキュリティ境界を構成しない**。認証・認可・課金判定の根拠に belief を使ってはならない(hono-jev-router 作者の警告に倣う)。これらは決定論的なコードで行い、belief は「どちらに振るか」だけを担う。

## 10. Open Questions

1. `&` の合成を `a*b` でよいか。相関のある陳述("怒っている" & "不満を表明している")では実確率を過小評価する。`&` を「1 つの結合 Noul」として API に投げ直す選択肢もある(精度↑・バッチ効率↓)。
2. catch-all `_` を必須にするか。必須にすると「確率的に全落ち」を言語が強制的に扱えるが、探査的な flow ではうるさい。
3. `score` の rubric 序数の暗黙採番は可読性と引き換えに危ういかも。`低=1 | 中=2 ...` の明示記法を用意するか。
4. flow の戻り値型推論をどこまでやるか(全ガードの action の union か、明示注記必須か)。

## 11. `route` 構文と Hono バックエンド(v0.1 候補)

`route` は flow を HTTP ルーティングに特化させたトップレベル構文。コンパイルターゲットとして **Hono / hono-jev-router** を選べる。

### 11.1 文法

```bnf
<route-decl> ::= "route" <string-literal> [ "@" <number> ] "(" <params> ")" "->" <action>
              |  "route" "_" "(" <params> ")" "->" <action>   ; 全ルート不成立時
```

- 文字列はルートの**自然言語の説明文**。belief と同じく条件位置のリテラルであり、リクエスト(method / path / headers / 切り詰めた body)を state として評価される。
- `@ n` はルートマッチの閾値(省略時 0.5。hono-jev-router のデフォルトと一致)。
- `route _` は catch-all で、全ルート不成立時のハンドラ。

### 11.2 例とコンパイル先

```bel
route "返金・キャンセルに関する問い合わせ" @ 0.6 (c: Context) ->
  refund(c)

route "AIエージェントからのリクエスト" (c: Context) ->
  agentHandler(c)

route _ (c: Context) -> c.json({ error: "unrouted" }, 404)
```

**ターゲット `hono-jev-router`(互換モード)** — 既存の hono-jev-router プロジェクトと同じ API 形状の TS を吐く:

```ts
app.on("jev", "返金・キャンセルに関する問い合わせ", refund, { threshold: 0.6 });
app.on("jev", "AIエージェントからのリクエスト", agentHandler);
app.all("*", (c) => c.json({ error: "unrouted" }, 404));
```

**ターゲット `hono`(バッチ評価モード)** — 依存を増やさず、bel のプリフライト評価(§5.1)で全ルートを 1 回のバッチ API コールで判定する独自ルータを生成:

```ts
app.all("*", async (c) => {
  const state = await __bel.requestState(c); // method/path/headers/切り詰めたbody
  const $r = await __bel.evaluate(
    [
      { id: 0, type: "noul", q: "返金・キャンセルに関する問い合わせ" },
      { id: 1, type: "noul", q: "AIエージェントからのリクエスト" },
    ],
    state,
  );
  if ($r[0].value >= 0.6) return refund(c);
  if ($r[1].value >= 0.5) return agentHandler(c);
  return c.json({ error: "unrouted" }, 404);
});
```

バッチモードの利点:

- ルート数が増えても **API コールは 1 回**(Jev の並列評価の直訳)。
- `choice` による**排他的ルーティング**に切り替え可能(`route.choice` 修飾子。「最確の 1 ルートのみ発火」で確率が合計 1 になる)。Noul 独立評価による多重マッチ・全不マッチの曖昧さを言語側で制御できる。
- `mock beliefs` / cassette / confidence floor(§7)がルーティングの E2E テストにそのまま使える。

### 11.3 設計上の注意

- パスルート(通常の Hono ルート)が存在する場合はそちらが優先される、hono-jev-router の動作に倣う。bel 側では `route "/path"` のように文字列が `/` で始まる場合は決定論的パスルートとして扱い、belief 評価の対象から外す。
- リクエストの state 化はサイズ上限を持つ(body は先頭 N バイトのみ。N はコンパイラオプション)。

---

_編集メモ: Civet と同じく独自パーサ → TS 出力のアーキテクチャ。belief 層は自前 PEG パーサ、action 島は oxc、型検査は tsc に委譲。_
