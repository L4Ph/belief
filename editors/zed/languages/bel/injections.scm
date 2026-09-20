; The islands are TypeScript, and so are the parts of a declaration bel only
; carries: the parameter list, the return type and a test's body.
((line_island) @injection.content
  (#set! injection.language "typescript"))

((block_island) @injection.content
  (#set! injection.language "typescript"))

((parameter_list) @injection.content
  (#set! injection.language "typescript"))

((test_declaration (raw_line) @injection.content)
  (#set! injection.language "typescript"))

((type_declaration (block_island) @injection.content)
  (#set! injection.language "typescript"))
