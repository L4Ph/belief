/**
 * A tree-sitter grammar for bel, for editors (Zed uses tree-sitter only).
 *
 * Islands — the raw TypeScript on the right of `->` — are the reason this
 * grammar has an external scanner: a block island is a brace-balanced region,
 * which a regular expression cannot express. A line island ends at the newline
 * and is an ordinary token.
 */
module.exports = grammar({
  name: "bel",

  extras: ($) => [/\s/, $.comment],

  externals: ($) => [$.block_island, $.line_island, $.guards_keyword, $.parameter_list],

  word: ($) => $.identifier,

  rules: {
    source_file: ($) => repeat($._declaration),

    comment: () => token(seq("//", /[^\n]*/)),

    _declaration: ($) =>
      choice(
        $.import_declaration,
        $.type_declaration,
        $.flow_declaration,
        $.mock_declaration,
        $.test_declaration,
        $.route_declaration,
      ),

    // import / type / interface are TypeScript bel does not interpret.
    import_declaration: ($) => seq("import", $.raw_line),

    // `type X = A | B`, `type X = { … }`, `interface X { … }`
    type_declaration: ($) =>
      seq(
        choice("type", "interface"),
        $.identifier,
        choice(seq("=", choice($.block_island, $.raw_line)), $.block_island, $.raw_line),
      ),

    flow_declaration: ($) =>
      seq(
        optional("export"),
        "flow",
        $.identifier,
        $.parameter_list,
        ":",
        $.raw_line,
        repeat($.binding),
        repeat($.guard),
      ),

    binding: ($) =>
      seq("let", $.identifier, "=", choice($.score_expression, $.choice_expression, $._belief)),

    score_expression: ($) => seq("score", $.string, "in", $.rubric),
    choice_expression: ($) => seq("choice", $.string, "in", $.rubric),
    rubric: ($) => seq($.label, repeat(seq("|", $.label))),

    guard: ($) =>
      choice(seq($._belief, optional($.threshold), "->", $._action), seq("_", "->", $._action)),

    threshold: ($) => seq("@", $.number),

    _action: ($) => choice($.guards_block, $.block_island, $.line_island),

    guards_block: ($) => seq($.guards_keyword, "{", repeat($.guard), "}"),

    _belief: ($) =>
      choice($.belief_literal, $.reference, $.comparison, $.and, $.or, $.not, $.parenthesized),

    belief_literal: ($) => $.string,
    reference: ($) => $.identifier,
    comparison: ($) => seq($.identifier, $.comparison_operator, choice($.label, $.level)),
    comparison_operator: () => choice(">=", "<=", "==", ">", "<"),
    level: () => /[0-9]+/,

    and: ($) => prec.left(2, seq($._belief, "&", $._belief)),
    or: ($) => prec.left(1, seq($._belief, "|", $._belief)),
    not: ($) => prec(3, seq("~", $._belief)),
    parenthesized: ($) => seq("(", $._belief, ")"),

    mock_declaration: ($) => seq("mock", "beliefs", repeat1($.mock_entry)),
    mock_entry: ($) => seq($.string, "=>", $.mock_value),
    mock_value: ($) => choice($.number, $.string, seq("{", repeat($.mock_field), "}")),
    mock_field: ($) => seq($.identifier, ":", choice($.number, $.string), optional(",")),

    test_declaration: ($) => seq("test", optional(".snapshot"), $.string, repeat1($.raw_line)),

    route_declaration: ($) =>
      seq("route", choice($.string, "_"), optional($.threshold), $.parameter_list, "->", $._action),

    label: ($) => $.identifier,
    identifier: () => /[A-Za-z_][A-Za-z0-9_]*/,
    string: () => token(seq('"', repeat(choice(/\\./, /[^"\\\n]/)), '"')),
    number: () => /[0-9]+(\.[0-9]+)?/,
    // A raw line must not start with `=`, or `type X = { … }` would read the
    // whole thing as one line and never open the block.
    raw_line: () => token(/[^=\s\n][^\n]*/),
  },
});
