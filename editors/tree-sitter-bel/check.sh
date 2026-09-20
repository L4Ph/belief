#!/usr/bin/env bash
# Parse every example and fail on a syntax error in the tree.
#
# The examples are the grammar's integration test: if the editor cannot parse a
# file the compiler accepts, the grammar is behind the language.
set -euo pipefail
cd "$(dirname "$0")"

status=0
for file in ../../examples/*/*.bel; do
  if ! output=$(tree-sitter parse "$file" 2>/dev/null); then
    echo "FAIL $file"
    echo "$output" | grep -E "ERROR|MISSING" | head -3
    status=1
  fi
done

if [ "$status" -eq 0 ]; then
  echo "all examples parse"
fi
exit "$status"
