// ============================================================
// bel.peggy — bel 言語仕様 v0 (§3, §11) に基づく文法スケルトン
//
// 使い方:
//   npx peggy bel.peggy            # parser.js を生成
//   npx peggy -c peggy.config.js   # TS/ESM 出力の設定も可
//
// 設計上の注意:
// - action 部(TS の島)はここでは「生テキスト」として切り出すだけ。
//   パースは oxc に委譲する(仕様書 §6)。このファイルは島の境界だけを決める。
// - PEG は順序つき選択。上から順に試して最初にマッチしたルールが勝つ。
//   bel のガードの「上から順に評価」と同じ意味論。
// - belief 演算子の優先順位: ~ > & > | (数値演算の - * + に相当)
// ============================================================

{{
  // バランス括弧の再帰結果([文字, ["(", ...], ...])を平坦化する
  function flatten(x) {
    return Array.isArray(x) ? x.map(flatten).join("") : x
  }
}}

// ------------------------------------------------------------
// Program: トップレベル宣言の並び(空行を許容)
// ------------------------------------------------------------

Program
  = Blank* decls:(d:Toplevel Blank* { return d })* {
      return { type: "Program", body: decls }
    }

Toplevel
  = ImportDecl     // import は生テキストで保持し、出力 TS にそのまま通す
  / TypeDecl       // type / interface も同様(生テキスト)
  / BeliefLet      // let name = "陳述" & ~"別の陳述"
  / FlowDecl
  / RouteDecl      // §11
  / TestDecl       // §7

// ------------------------------------------------------------
// import / type 宣言: 生テキストの島(oxc 行き)
// 行頭の import / type / interface から文末までを丸ごと取る
// ------------------------------------------------------------

ImportDecl
  = "import" _ raw:RawToEol EOS {
      return { type: "ImportDecl", raw: "import " + raw }
    }

TypeDecl
  = kw:("type" / "interface") _ raw:RawBlock EOS {
      return { type: "TypeDecl", raw: kw + " " + raw }
    }

// ------------------------------------------------------------
// belief の let 束縛: let tech = "技術的な問題を報告している"
// ------------------------------------------------------------

BeliefLet
  = "let" __ name:Ident _ "=" _ expr:BeliefExpr EOS {
      return { type: "BeliefLet", name, expr }
    }

// ------------------------------------------------------------
// flow 定義
//   flow support(ticket: Ticket): Action
//     <guard-list>
// ------------------------------------------------------------

FlowDecl
  = "flow" __ name:Ident _ params:ParenRaw ret:ReturnType? EOS
      guards:GuardList {
      return {
        type: "FlowDecl",
        name,
        params,          // 生テキスト "(ticket: Ticket)" — oxc 行き
        returnType: ret, // 生テキスト "Action" | null
        guards,
      }
    }

ReturnType
  = ":" _ raw:$[^\r\n{]+ { return raw.trim() }

// ------------------------------------------------------------
// route 定義 (§11)
//   route "返金に関する問い合わせ" @ 0.6 (c: Context) -> refund(c)
//   route _ (c: Context) -> c.json({...}, 404)
// ------------------------------------------------------------

RouteDecl
  = "route" __ target:(StringLiteral / "_") _ threshold:Threshold?
      _ params:ParenRaw _ "->" _ action:ActionExpr EOS {
      return {
        type: "RouteDecl",
        // "/" 始まりの文字列は決定論的パスルート(仕様書 §11.3)
        kind: target === "_" ? "catchall"
           : target.value.startsWith("/") ? "path" : "belief",
        description: target === "_" ? null : target.value,
        threshold,
        params,
        action,
      }
    }

// ------------------------------------------------------------
// ガード列: 上から順に評価、最初に閾値を超えたものが発火
//   "怒っている" @ 0.7 -> escalate(t)
//   "返金要求" & "14日以内" -> refund(t)
//   _ -> reply("...")
// ------------------------------------------------------------

GuardList
  = guards:(CatchallGuard / Guard)+ {
      // catchall は最後に 1 つだけ、という制約は semantic check で行う
      // (PEG は順序つきなので文法上は弾きにくい → コンパイラの検査パスへ)
      return guards
    }

Guard
  = IND cond:BeliefExpr _ threshold:Threshold? _ "->" _ action:Action EOS {
      return { type: "Guard", cond, threshold, action }
    }

CatchallGuard
  = IND "_" _ "->" _ action:Action EOS {
      return { type: "Guard", cond: null /* catchall */, threshold: null, action }
    }

Threshold
  = "@" _ n:Number {
      if (n < 0 || n > 1) error(`threshold must be 0..1, got ${n}`)
      return n
    }

// ------------------------------------------------------------
// belief 式: 優先順位 ~ > & > |
// ------------------------------------------------------------

BeliefExpr
  = head:BeliefAnd tail:(_ "|" _ @BeliefAnd)* {
      return tail.length
        ? { type: "BeliefOr", operands: [head, ...tail] }
        : head
    }

BeliefAnd
  = head:BeliefUnary tail:(_ "&" _ @BeliefUnary)* {
      return tail.length
        ? { type: "BeliefAnd", operands: [head, ...tail] }
        : head
    }

BeliefUnary
  = "~" _ expr:BeliefUnary {
      return { type: "BeliefNot", operand: expr }
    }
  / "(" _ expr:BeliefExpr _ ")" { return expr }
  / lit:StringLiteral {
      // ★ 言語の核心: 条件位置の文字列リテラルは belief になる
      return { type: "BeliefLiteral", question: lit.value }
    }
  / name:Ident {
      // let 束縛した belief の参照。未定義チェックは semantic check で
      return { type: "BeliefRef", name }
    }

// ------------------------------------------------------------
// action: TS の島。
//   単一行:  -> refund(ticket)
//   ブロック: -> {
//     const x = ...
//     return ...
//   }
//   ガードのネスト: -> の後に更にガードが続く場合は
//   インデントで判別するのではなく、明示的な "guard {" を要求する方針
//   (v0 ではネストガードは flow 呼び出しに書き換えることを推奨)
// ------------------------------------------------------------

Action
  = "{" _ body:BalancedBraces _ "}" {
      return { type: "ActionBlock", raw: body }   // oxc 行き
    }
  / expr:RawToEol {
      return { type: "ActionExpr", raw: expr }    // oxc 行き
    }

ActionExpr  // route 用: 同じもの(別名を残して拡張余地を確保)
  = expr:RawToEol { return { type: "ActionExpr", raw: expr } }

// ------------------------------------------------------------
// テスト構文 (§7)
//   mock beliefs
//     "怒っている" => 0.9
//   test "説明"
//     ...
//   test.snapshot "名前"
//     record "cassettes/x.json"
// ------------------------------------------------------------

TestDecl
  = MockBlock / TestBlock

MockBlock
  = "mock" __ "beliefs" EOS entries:MockEntry+ {
      return { type: "MockBeliefs", entries }
    }

MockEntry
  = IND q:StringLiteral _ "=>" _ v:Number EOS {
      return { question: q.value, value: v }
    }

TestBlock
  = "test" snapshot:".snapshot"? __ name:StringLiteral EOS
      body:(WithFloor / RecordDecl / RawLine)* {
      return { type: snapshot ? "TestSnapshot" : "Test", name: name.value, body }
    }

WithFloor
  = _ "with" __ "confidence_floor" __ n:Number EOS {
      return { type: "ConfidenceFloor", value: n }
    }

RecordDecl
  = _ "record" __ path:StringLiteral EOS {
      return { type: "Record", path: path.value }
    }

// ------------------------------------------------------------
// 字句レベル
// ------------------------------------------------------------

// 文字列リテラル: "..." (エスケープは \" と \\ のみ v0 ではサポート)
StringLiteral
  = '"' chars:StringChar* '"' {
      return { type: "StringLiteral", value: chars.join("") }
    }

StringChar
  = '\\' c:["\\]   { return c }
  / [^"\r\n]

Ident
  = $([A-Za-z_][A-Za-z0-9_]*)

Number
  = n:$([0-9]+ ("." [0-9]+)?) { return parseFloat(n) }

// TS 式の島: 行末まで / 対応括弧までの生テキスト
RawToEol
  = raw:$[^\r\n]+ { return raw.trim() }

RawLine
  = _ raw:$[^\r\n]+ EOS { return { type: "RawLine", raw } }

ParenRaw
  = "(" inner:BalancedParens ")" { return "(" + inner + ")" }

RawBlock
  = raw:$([^\r\n]* ("\r\n" [^ \t\r\n] [^\r\n]*)*) { return raw }  // 行継続は簡易対応

// 対応の取れた括弧の中身(ネスト対応)
BalancedParens
  = chars:([^()] / "(" BalancedParens ")")* {
      return flatten(chars)
    }

BalancedBraces
  = chars:([^{}] / "{" BalancedBraces "}")* {
      return flatten(chars)
    }

// 空白・改行
_     = [ \t]*                          // 行内空白
__    = [ \t]+                          // 必須の行内空白
IND   = "  " / "\t" / "    "            // ガード等の1段インデント
EOS   = _ ("\r\n" / "\n" / !.)          // 行末(EOF でもよい)
Blank = _ ("\r\n" / "\n")               // 空行(空白のみの行を含む)
