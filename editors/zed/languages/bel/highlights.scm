; Keywords
[
  "import"
  "export"
  "flow"
  "let"
  "score"
  "choice"
  "in"
  "mock"
  "beliefs"
  "test"
  ".snapshot"
  "route"
] @keyword

(guards_keyword) @keyword

; The catch-all guard reads as a keyword, not as a name.
"_" @keyword

; Operators
[
  "->"
  "=>"
  "@"
  "="
  "&"
  "|"
  "~"
] @operator

(comparison_operator) @operator

; Punctuation
["(" ")" "{" "}"] @punctuation.bracket
["," ":"] @punctuation.delimiter

; Literals
(string) @string
(number) @number

(comment) @comment

; Names
(flow_declaration (identifier) @function)
(binding (identifier) @variable)
(comparison (identifier) @variable)
(reference (identifier) @variable)
(label (identifier) @constant)
(mock_field (identifier) @property)
