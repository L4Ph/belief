# bel for Zed

Highlights `.bel` files with the tree-sitter grammar in
`editors/tree-sitter-bel`, and runs `bel-lsp` for diagnostics, hover and level
completion.

## Install, while this is a development extension

1. Build the language server and put it on your path:

   ```bash
   vp run -r build
   ln -sf "$PWD/packages/lsp/dist/bin.mjs" /usr/local/bin/bel-lsp
   ```

2. In `extension.toml`, point `[grammars.bel]` at this repository. Until it has
   a remote, use a local URL and the current commit:

   ```toml
   [grammars.bel]
   repository = "file:///path/to/belief"
   rev = "<git rev-parse HEAD>"
   path = "editors/tree-sitter-bel"
   ```

3. In Zed: `zed: extensions` → **Install Dev Extension** → choose `editors/zed`.

Zed compiles the grammar and the extension on install, so the first install
takes a minute. `zed --foreground` shows the log if something goes wrong.

## After publishing

Push the repository, set `repository` in `extension.toml` to the remote URL, and
bump `rev` whenever the grammar changes — Zed clones the grammar at that
revision rather than reading the working tree.
