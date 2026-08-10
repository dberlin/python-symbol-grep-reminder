# Structural Alternation Detection Design

## Goal

Extend the conservative Python symbol grep classifier to detect structural regex alternations such as `class ControllerModelStore|def load|def _read_state|return None`. The search remains unchanged; matching results receive the existing LSP reminder.

## Root Cause

The current classifier evaluates the normalized search pattern as one expression. It recognizes complete declarations such as `def load(` and `class ControllerModelStore:`, or a `def` search at the beginning of the pattern. In an alternation beginning with an incomplete class branch, later `def`, `return`, and call branches do not contribute independent structural evidence.

## Classification Rule

The classifier will inspect unescaped regex alternatives and recognize these branch shapes after existing regex normalization:

- Python function declarations beginning with `def name` or `async def name`;
- Python class declarations beginning with `class Name`;
- return statements beginning with `return` and followed by an expression or branch end;
- call expressions beginning with a dotted identifier and ending in an opening parenthesis pattern.

An alternation is structural when at least two branches have recognized shapes. It supplies Python and symbol evidence only when either:

1. at least one recognized branch is a `def` or `class` declaration; or
2. the existing candidate scope supplies explicit Python evidence.

This catches mixed declaration/return/call navigation patterns without treating a single incomplete declaration as sufficient evidence. Literal escaped pipes are not branch separators.

## Architecture

Add a side-effect-free helper in `src/detector.ts` that classifies the normalized pattern's alternatives. `classifies` will combine its result with the existing declaration, scope, call, and decorator checks. Candidate traversal, context-mode traversal, lifecycle correlation, and reminder text remain unchanged.

Shell candidate extraction will split commands only at unquoted, unescaped shell separators before matching `grep` or `rg`. Quoted alternation pipes therefore remain part of the search pattern, while real pipelines remain separate commands.

The structural helper will use bounded string scanning rather than a general-purpose regex parser. The detector already operates on short tool-call input, and only escaped-pipe handling plus branch trimming is required for this contract.

## False-Positive Boundaries

The following remain unclassified unless another existing rule matches:

- generic alternations such as `TODO|FIXME`;
- one structural branch mixed with prose, such as `TODO|return code`;
- escaped literal-pipe searches;
- return/call alternations outside explicit Python scope;
- generic identifiers in Python files.

## Verification

Table-driven detector tests will cover:

- the reported `class ControllerModelStore|def load|def _read_state|return None` pattern from repository scope;
- grouped and regex-escaped declaration alternatives;
- return/call alternatives with explicit Python scope;
- quoted alternations passed through the shell command surface;
- generic, escaped-pipe, single-structural-branch, and non-Python negatives.

The focused detector test must fail before implementation and pass afterward. Final verification will run the complete Bun test suite, TypeScript typecheck, and a direct smoke invocation of the reported pattern.
