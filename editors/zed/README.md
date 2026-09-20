# bel for Zed

Highlights `.bel` files with the tree-sitter grammar in
`editors/tree-sitter-bel`, and runs `bel-lsp` for diagnostics, hover and level
completion.

Zed reads a language's queries from **here**, in `languages/bel/`, and not from
the grammar repository's `queries/` directory — which is where tree-sitter
grammars conventionally keep them. The files are therefore copies:
`editors/tree-sitter-bel/queries/*.scm` is the original, and
`editors/tree-sitter-bel/check.sh` fails if the two drift apart.

## Install, while this is a development extension

1. Build the language server and put it on your path:

   ```bash
   vp run -r build
   mkdir -p ~/.local/bin
   ln -sf "$PWD/packages/lsp/dist/bin.mjs" ~/.local/bin/bel-lsp
   ```

2. In `extension.toml`, point `[grammars.bel]` at this repository. While the
   repository is private (and while the extension is a dev extension), use a
   local URL and the current commit:

   ```toml
   [grammars.bel]
   repository = "file:///path/to/belief"
   rev = "<git rev-parse HEAD>"
   path = "editors/tree-sitter-bel"
   ```

3. In Zed: `zed: extensions` → **Install Dev Extension** → choose `editors/zed`.

Zed compiles the grammar and the extension on install, so the first install
takes a minute. **Changing a query means installing the dev extension again** —
Zed copies the language files at install time.

## After publishing

Push the repository, set `repository` in `extension.toml` to the remote URL, and
bump `rev` whenever the grammar changes — Zed clones the grammar at that
revision rather than reading the working tree.
