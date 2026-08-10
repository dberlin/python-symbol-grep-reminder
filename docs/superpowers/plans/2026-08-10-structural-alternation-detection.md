# Structural Alternation Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect conservative OR-combinations of Python declaration, return, and call search patterns, including `class ControllerModelStore|def load|def _read_state|return None`.

**Architecture:** Add branch-aware structural classification inside `src/detector.ts`: split only on unescaped alternation pipes, classify each normalized branch, and require two structural branches plus either declaration evidence or existing Python scope. Split shell commands only on unquoted, unescaped separators so quoted alternations reach the classifier intact.

**Tech Stack:** TypeScript 7, Bun test runner, existing side-effect-free detector API.

## Global Constraints

- Preserve the existing low-false-positive classifier policy.
- Never block or rewrite the original search.
- Literal escaped pipes are not alternation separators.
- Return/call-only alternations require explicit Python scope.
- Add no runtime dependency and change no exported interface.

---

### Task 1: Structural Alternation Classifier

**Files:**
- Modify: `test/detector.test.ts:4-213`
- Modify: `src/detector.ts:20-378`

**Interfaces:**
- Consumes: existing `classifies(candidate: Candidate): boolean` and `normalizeRegexSyntax(value: string): string`.
- Produces: private `classifiesStructuralAlternation(pattern: string, hasPythonScope: boolean): boolean` and quote-aware shell command segmentation; no exported API changes.

- [ ] **Step 1: Add failing positive and negative fixtures**

Add these table entries to `positive`:

```ts
[
  "built-in grep for alternated Python structures",
  {
    toolName: "grep",
    input: {
      pattern: "class ControllerModelStore|def load|def _read_state|return None",
      path: ".",
    },
  },
],
[
  "grouped alternated Python structures",
  {
    toolName: "grep",
    input: {
      pattern: String.raw`^(?:class\s+ControllerModelStore|def\s+load|return\s+None)$`,
      path: ".",
    },
  },
],
[
  "return and call alternatives in Python scope",
  {
    toolName: "grep",
    input: {
      pattern: String.raw`return\s+None|controller\.load\(`,
      path: "src/**/*.py",
    },
  },
],
[
  "shell rg for quoted alternated Python structures",
  {
    toolName: "bash",
    input: {
      command: "rg 'class ControllerModelStore|def load|def _read_state|return None' -g '*.py' src",
    },
  },
],
```

Add these table entries to `negative`:

```ts
[
  "generic alternation",
  { toolName: "grep", input: { pattern: "TODO|FIXME", path: "src/**/*.py" } },
],
[
  "single structural alternative mixed with prose",
  { toolName: "grep", input: { pattern: "TODO|return code", path: "src/**/*.py" } },
],
[
  "escaped literal pipe",
  {
    toolName: "grep",
    input: { pattern: String.raw`def load\|return None`, path: "." },
  },
],
[
  "return and call alternatives outside Python scope",
  {
    toolName: "grep",
    input: { pattern: String.raw`return null|controller\.load\(`, path: "src/**/*.ts" },
  },
],
```

Plausible regression caught: treating any `|`, any `return`, or any call-like branch as sufficient evidence.

- [ ] **Step 2: Run the focused detector test and verify RED**

Run: `bun test test/detector.test.ts`

Expected: the reported built-in, grouped, and quoted-shell fixtures fail with `Expected: true, Received: false`; existing and new negative fixtures pass.

- [ ] **Step 3: Add the minimal private classifier**

In `src/detector.ts`, add private branch-shape regexes for declaration, return, and call alternatives. Implement `classifiesStructuralAlternation(pattern, hasPythonScope)` with this behavior:

```ts
type StructuralBranch = "declaration" | "other";

function structuralBranchKind(pattern: string): StructuralBranch | undefined {
  const normalized = normalizeRegexSyntax(pattern);
  // Ignore leading anchors and one or more opening capture/non-capture groups.
  // Return "declaration" for def/class prefixes.
  // Return "other" for return/call prefixes.
  // Otherwise return undefined.
}

function classifiesStructuralAlternation(pattern: string, hasPythonScope: boolean): boolean {
  // Scan once, splitting only on pipes not preceded by an odd backslash run.
  // Classify every branch, including the final branch.
  // Return true when at least two branches are structural and either a
  // declaration branch exists or hasPythonScope is true.
}
```

Replace regex-only shell command boundary extraction with a quote-aware scanner. It must split on newline, `;`, `&`, and `|` only outside quotes and when the separator is not escaped. Apply the existing invocation matcher and pattern tokenizer independently to each resulting shell command.

Call the helper from `classifies` using `candidate.pattern` and the already computed `hasPythonScope`. Treat a true result as both Python and symbol evidence. Preserve existing pattern tokenization and exported types.

- [ ] **Step 4: Run the focused detector test and verify GREEN**

Run: `bun test test/detector.test.ts`

Expected: all detector fixtures pass with no errors or warnings.

- [ ] **Step 5: Run complete verification**

Run: `bun test`

Expected: all project tests pass.

Run: `bun run typecheck`

Expected: exit status 0 with no TypeScript diagnostics.

Run:

```bash
PATTERN='class ControllerModelStore|def load|def _read_state|return None' \
  bun -e 'import { isPythonSymbolGrepCall } from "./src/detector.ts"; console.log(isPythonSymbolGrepCall({toolName:"grep",input:{pattern:process.env.PATTERN,path:"."}}));'
```

Expected: `true`.

- [ ] **Step 6: Commit the implementation**

With Jujutsu, create or describe an implementation revision before editing and verify it afterward:

```bash
jj new -m "Detect alternated Python structures"
jj st
```
