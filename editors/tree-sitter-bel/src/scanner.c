/**
 * Everything on the right of `->` is raw TypeScript, and tree-sitter's regular
 * expressions cannot describe it: a block island is brace-balanced, and a line
 * island runs to the newline. Both, plus the `guards` keyword that introduces a
 * nested guard list, are decided here so that no internal token competes with
 * them.
 *
 * The decision needs no backtracking: by the time we look, we have already
 * committed to consuming an island, so a word that turns out not to be
 * `guards` is simply the start of one.
 */
#include "tree_sitter/parser.h"

enum TokenType {
  BLOCK_ISLAND,
  LINE_ISLAND,
  GUARDS_KEYWORD,
  PARAMETER_LIST,
};

void *tree_sitter_bel_external_scanner_create(void) { return NULL; }
void tree_sitter_bel_external_scanner_destroy(void *payload) {}
unsigned tree_sitter_bel_external_scanner_serialize(void *payload, char *buffer) { return 0; }
void tree_sitter_bel_external_scanner_deserialize(void *payload, const char *buffer, unsigned length) {}

static bool is_identifier_char(int32_t c) {
  return c == '_' || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9');
}

/** Consume a quoted region, escapes included. */
static void skip_quoted(TSLexer *lexer, int32_t quote) {
  for (;;) {
    lexer->advance(lexer, false);
    if (lexer->eof(lexer)) return;
    if (lexer->lookahead == '\\') {
      lexer->advance(lexer, false);
      continue;
    }
    if (lexer->lookahead == quote) {
      lexer->advance(lexer, false);
      return;
    }
  }
}

static void skip_to_end_of_line(TSLexer *lexer) {
  while (!lexer->eof(lexer) && lexer->lookahead != '\n') lexer->advance(lexer, false);
}

/** Consume a bracketed region, from the opening bracket through its match. */
static void skip_group(TSLexer *lexer, int32_t open, int32_t close) {
  int depth = 0;
  for (;;) {
    if (lexer->eof(lexer)) return;
    int32_t c = lexer->lookahead;
    if (c == open) {
      depth += 1;
    } else if (c == close) {
      depth -= 1;
      lexer->advance(lexer, false);
      if (depth == 0) return;
      continue;
    } else if (c == '"' || c == '\'' || c == '`') {
      skip_quoted(lexer, c);
      continue;
    } else if (c == '/') {
      lexer->advance(lexer, false);
      if (lexer->lookahead == '/') {
        skip_to_end_of_line(lexer);
        continue;
      }
      if (lexer->lookahead == '*') {
        for (;;) {
          lexer->advance(lexer, false);
          if (lexer->eof(lexer)) return;
          if (lexer->lookahead == '*') {
            lexer->advance(lexer, false);
            if (lexer->lookahead == '/') {
              lexer->advance(lexer, false);
              break;
            }
          }
        }
        continue;
      }
      continue;
    }
    lexer->advance(lexer, false);
  }
}

/**
 * `guards` when a `{` follows it. Consumes the word either way: the caller has
 * already committed to an island, so a mismatch continues as one.
 */
static bool take_guards_keyword(TSLexer *lexer) {
  static const char *word = "guards";
  for (int i = 0; i < 6; i++) {
    if (lexer->eof(lexer) || lexer->lookahead != word[i]) return false;
    lexer->advance(lexer, false);
  }
  if (is_identifier_char(lexer->lookahead)) return false;
  while (lexer->lookahead == ' ' || lexer->lookahead == '\t') lexer->advance(lexer, true);
  return lexer->lookahead == '{';
}

bool tree_sitter_bel_external_scanner_scan(void *payload, TSLexer *lexer, const bool *valid_symbols) {
  bool want_block = valid_symbols[BLOCK_ISLAND];
  bool want_line = valid_symbols[LINE_ISLAND];
  bool want_guards = valid_symbols[GUARDS_KEYWORD];
  bool want_params = valid_symbols[PARAMETER_LIST];
  if (!want_block && !want_line && !want_guards && !want_params) return false;

  while (lexer->lookahead == ' ' || lexer->lookahead == '\t') lexer->advance(lexer, true);

  if (want_params && lexer->lookahead == '(') {
    skip_group(lexer, '(', ')');
    lexer->result_symbol = PARAMETER_LIST;
    return true;
  }

  if (want_block && lexer->lookahead == '{') {
    skip_group(lexer, '{', '}');
    lexer->result_symbol = BLOCK_ISLAND;
    return true;
  }

  if (lexer->eof(lexer) || lexer->lookahead == '\n') {
    // `->` may put a nested guard list on the line below. Nothing else can
    // follow an arrow across a newline, and skipping whitespace costs nothing.
    if (!want_guards) return false;
    while (lexer->lookahead == '\n' || lexer->lookahead == '\r' || lexer->lookahead == ' ' ||
           lexer->lookahead == '\t') {
      lexer->advance(lexer, true);
    }
    if (lexer->lookahead != 'g') return false;
  }

  if (want_guards && lexer->lookahead == 'g' && take_guards_keyword(lexer)) {
    lexer->result_symbol = GUARDS_KEYWORD;
    return true;
  }

  if (want_line) {
    skip_to_end_of_line(lexer);
    lexer->result_symbol = LINE_ISLAND;
    return true;
  }

  return false;
}
