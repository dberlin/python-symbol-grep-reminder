# Python Symbol Grep Reminder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an installable OMP extension that conservatively detects grep/rg-based Python symbol navigation, allows the search, and prepends an LSP reminder to the tool result.

**Architecture:** A pure detector extracts bounded search candidates from built-in grep, shell, direct context-mode, batched context-mode, and mounted `write xd://` payloads. The extension correlates high-confidence calls by `toolCallId`, then returns a `tool_result` content override containing a leading reminder block followed by the untouched original content.

**Tech Stack:** TypeScript, Bun 1.3.14, Bun test, `@oh-my-pi/pi-coding-agent` 17.2.12, OMP extension API, Jujutsu.

## Global Constraints

- Searches MUST execute unchanged; the extension MUST NOT block or rewrite tool calls.
- Every reminder MUST be a new leading text content block, before all original result content.
- Detection MUST require an actual grep/rg invocation, Python evidence, and symbol/function evidence.
- Generic Python text searches such as `rg TODO -tpy` MUST remain unflagged.
- Nested payload parsing MUST be bounded, deterministic, fail-open, and free of model calls.
- Matching state MUST be cleared after the result and on `session_shutdown`.
- Use `lsp` for TypeScript symbol discovery, definitions, references, diagnostics, and code actions after `package.json` creates the TypeScript project root.
- Do not create compatibility aliases, deprecated entry points, runtime dependencies, or unrelated documentation.

---

## File Structure

- `package.json` — package identity, Bun scripts, OMP extension manifest, peer/dev dependencies.
- `tsconfig.json` — strict no-emit TypeScript project configuration.
- `src/detector.ts` — pure, bounded extraction and high-confidence classification.
- `src/index.ts` — OMP lifecycle registration, tool-call correlation, and reminder prefixing.
- `test/detector.test.ts` — positive/negative detector boundary matrix.
- `test/extension.test.ts` — handler correlation and result-prefix contract.
- `test/loader.test.ts` — real OMP loader smoke test.

### Task 1: Package and Conservative Detector

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `src/detector.ts`
- Create: `test/detector.test.ts`

**Interfaces:**
- Consumes: raw OMP `toolName: string` and `input: Record<string, unknown>`.
- Produces: `export interface ToolCallLike { toolName: string; input: Record<string, unknown> }`.
- Produces: `export function isPythonSymbolGrepCall(call: ToolCallLike): boolean`.

- [ ] **Step 1: Create package metadata and strict TypeScript configuration**

Create `package.json`:

```json
{
  "name": "omp-python-symbol-grep-reminder",
  "version": "0.1.0",
  "description": "Reminds OMP models to use LSP instead of grep for Python symbols",
  "type": "module",
  "scripts": {
    "test": "bun test",
    "typecheck": "tsc --noEmit"
  },
  "omp": {
    "extensions": ["./src/index.ts"]
  },
  "peerDependencies": {
    "@oh-my-pi/pi-coding-agent": ">=17.2.12 <18"
  },
  "devDependencies": {
    "@oh-my-pi/pi-coding-agent": "17.2.12",
    "@types/bun": "^1.3.14",
    "typescript": "^5.9.3"
  }
}
```

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Preserve",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["bun"]
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

Run: `bun install`

Expected: dependencies install and `bun.lock` is created.

Then use `lsp` `status` and `symbols` on the project TypeScript files as they are created. If import code actions are offered, apply them through `lsp` rather than editing imports manually.

- [ ] **Step 2: Write the failing detector matrix**

Create `test/detector.test.ts` with table-driven cases:

```ts
import { describe, expect, test } from "bun:test";
import { isPythonSymbolGrepCall, type ToolCallLike } from "../src/detector";

const positive: Array<[string, ToolCallLike]> = [
  [
    "built-in grep for a Python function declaration",
    { toolName: "grep", input: { pattern: String.raw`^\s*def\s+load_user\(`, path: "src/**/*.py" } },
  ],
  [
    "built-in grep for a Python call",
    { toolName: "grep", input: { pattern: String.raw`\bload_user\s*\(`, path: "src/**/*.py" } },
  ],
  [
    "rg shell command scoped by Python glob",
    { toolName: "bash", input: { command: String.raw`rg '^\s*def\s+load_user\(' -g '*.py' src` } },
  ],
  [
    "grep shell command scoped by Python type",
    { toolName: "bash", input: { command: String.raw`grep -R 'class User:' --include='*.py' src` } },
  ],
  [
    "direct context-mode execute",
    {
      toolName: "mcp__context_mode_ctx_execute",
      input: { language: "shell", code: String.raw`rg '\bload_user\s*\(' --type py src` },
    },
  ],
  [
    "context-mode batch command",
    {
      toolName: "mcp__context_mode_ctx_batch_execute",
      input: {
        commands: [{ label: "symbol", command: String.raw`rg '@cached_property' -g '*.py' src` }],
        queries: [],
      },
    },
  ],
  [
    "mounted context-mode write",
    {
      toolName: "write",
      input: {
        path: "xd://mcp__context_mode_ctx_execute",
        content: JSON.stringify({
          language: "shell",
          code: String.raw`rg '^async\s+def\s+refresh\(' --type py src`,
        }),
      },
    },
  ],
];

const negative: Array<[string, ToolCallLike]> = [
  ["generic Python TODO search", { toolName: "grep", input: { pattern: "TODO", path: "src/**/*.py" } }],
  ["bare identifier in Python", { toolName: "grep", input: { pattern: "load_user", path: "src/**/*.py" } }],
  ["function shape outside Python", { toolName: "grep", input: { pattern: String.raw`loadUser\(`, path: "src/**/*.ts" } }],
  ["Python prose search", { toolName: "bash", input: { command: "rg 'connection failed' --type py" } }],
  ["command that only prints grep prose", { toolName: "bash", input: { command: "printf 'use rg def foo in *.py'" } }],
  ["non-context mounted write", { toolName: "write", input: { path: "notes.txt", content: "rg 'def foo' -g '*.py'" } }],
  ["malformed mounted payload", { toolName: "write", input: { path: "xd://mcp__context_mode_ctx_execute", content: "{" } }],
  [
    "unrelated custom tool prose",
    { toolName: "summarize", input: { prompt: "Run rg '^def foo' against *.py" } },
  ],
];

describe("isPythonSymbolGrepCall", () => {
  test.each(positive)("detects %s", (_name, call) => {
    expect(isPythonSymbolGrepCall(call)).toBe(true);
  });

  test.each(negative)("ignores %s", (_name, call) => {
    expect(isPythonSymbolGrepCall(call)).toBe(false);
  });
});
```

- [ ] **Step 3: Run the detector test and confirm the expected failure**

Run: `bun test test/detector.test.ts`

Expected: FAIL because `../src/detector` does not exist.

- [ ] **Step 4: Implement bounded candidate extraction and classification**

Create `src/detector.ts` with these invariants:

```ts
export interface ToolCallLike {
  toolName: string;
  input: Record<string, unknown>;
}

type Candidate = {
  patternAndArguments: string;
  scope: string;
};

const MAX_NESTING_DEPTH = 5;
const MAX_VISITED_VALUES = 100;
const CONTEXT_EXECUTE_NAME = /(?:^|__)context[_-]?mode.*ctx_(?:batch_)?execute$/i;
const CONTEXT_WRITE_PATH = /^xd:\/\/mcp__context_mode_ctx_(?:batch_)?execute$/i;
const SEARCH_INVOCATION = /(?:^|[\n;&|]\s*|(?:execSync|spawnSync)\s*\(\s*["'`])(?:command\s+)?(?:[\w.-]+\/)?(?:rg|grep)\b([^\n;&|]*)/giu;

const PYTHON_SCOPE = /(?:\.py(?:\b|["'`*?])|--type(?:=|\s+)py\b|-tpy\b|--include(?:=|\s+)["'`]?[^\s]*\.py\b|-g(?:lob)?(?:=|\s+)["'`]?[^\s]*\.py\b)/iu;
const PYTHON_DECLARATION = /\b(?:async\s+)?def\s+[A-Za-z_]\w*\s*\(|\bclass\s+[A-Za-z_]\w*\s*(?:\([^)]*\))?\s*:/u;
const CALL_OR_DECORATOR = /(?:\b[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*\s*\(|@[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)/u;

function stringField(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" ? value : undefined;
}

function normalizeRegexSyntax(value: string): string {
  return value
    .replace(/\\s[+*?]?/gu, " ")
    .replace(/\\b/gu, "")
    .replace(/\\([()[\]{}.^$+*?|@])/gu, "$1");
}

function classifies(candidate: Candidate): boolean {
  const normalized = normalizeRegexSyntax(candidate.patternAndArguments);
  const hasDeclaration = PYTHON_DECLARATION.test(normalized);
  const hasPython = hasDeclaration || PYTHON_SCOPE.test(`${candidate.scope} ${candidate.patternAndArguments}`);
  const hasSymbol = hasDeclaration || CALL_OR_DECORATOR.test(normalized);
  return hasPython && hasSymbol;
}
```

Complete the file with private helpers that:

1. Convert built-in `grep` `{ pattern, path }` directly to one candidate.
2. Scan only recognized execution fields: `command`, `code`, and batch entries' `command`.
3. Accept command matches only when `rg`/`grep` begins at the command start, after a shell separator/newline, or inside a recognized `execSync`/`spawnSync` string.
4. For context-mode names matching `CONTEXT_EXECUTE_NAME`, recurse through only `code`, `commands`, and nested command objects.
5. For `write`, parse `content` only when `path` matches `CONTEXT_WRITE_PATH`; infer the context tool name from the path and recurse into the parsed record.
6. Stop at `MAX_NESTING_DEPTH` or `MAX_VISITED_VALUES` and catch JSON parse/type errors.
7. Return `candidates.some(classifies)` from `isPythonSymbolGrepCall`.

Do not recurse through arbitrary custom-tool properties such as `prompt`; that boundary prevents prose from becoming a false positive.

- [ ] **Step 5: Run detector tests and type diagnostics**

Run: `bun test test/detector.test.ts`

Expected: all detector matrix cases PASS.

Run `lsp` diagnostics on `src/detector.ts` and `test/detector.test.ts`.

Expected: no TypeScript errors. Apply relevant import/type fixes through `lsp` code actions.

- [ ] **Step 6: Commit the detector deliverable**

Run:

```bash
jj new -m "Add conservative Python symbol grep detector"
```

Expected: the package setup, lockfile, detector, and detector tests are committed in the parent; the new working revision is empty.

### Task 2: Non-Blocking Reminder Extension

**Files:**
- Create: `src/index.ts`
- Create: `test/extension.test.ts`

**Interfaces:**
- Consumes: `isPythonSymbolGrepCall(call: ToolCallLike): boolean` from Task 1.
- Produces: `export const REMINDER: string`.
- Produces: default OMP factory `(pi: ExtensionAPI) => void` registering `tool_call`, `tool_result`, and `session_shutdown` handlers.

- [ ] **Step 1: Write failing lifecycle and prefix tests**

Create `test/extension.test.ts`. Use a minimal fake API that captures handlers by event name, then assert:

```ts
import { describe, expect, test } from "bun:test";
import type { ExtensionAPI, ToolCallEvent, ToolResultEvent } from "@oh-my-pi/pi-coding-agent";
import extension, { REMINDER } from "../src/index";

type Handler = (event: never, ctx: never) => unknown;

function loadHandlers(): Map<string, Handler> {
  const handlers = new Map<string, Handler>();
  const pi = {
    on(name: string, handler: Handler) {
      handlers.set(name, handler);
    },
  } as unknown as ExtensionAPI;
  extension(pi);
  return handlers;
}

const matchingCall = {
  type: "tool_call",
  toolCallId: "call-1",
  toolName: "grep",
  input: { pattern: String.raw`^\s*def\s+load_user\(`, path: "src/**/*.py" },
} as ToolCallEvent;

const result = {
  type: "tool_result",
  toolCallId: "call-1",
  toolName: "grep",
  input: matchingCall.input,
  content: [{ type: "text", text: "src/users.py:10:def load_user(" }],
  details: { matches: 1 },
  isError: false,
} as unknown as ToolResultEvent;

describe("Python symbol grep reminder extension", () => {
  test("prepends a reminder and leaves original content untouched", async () => {
    const handlers = loadHandlers();
    await handlers.get("tool_call")!(matchingCall as never, {} as never);
    const patch = await handlers.get("tool_result")!(result as never, {} as never);

    expect(patch).toEqual({
      content: [{ type: "text", text: REMINDER }, ...result.content],
    });
    expect(result.content).toEqual([{ type: "text", text: "src/users.py:10:def load_user(" }]);
    expect(patch).not.toHaveProperty("details");
    expect(patch).not.toHaveProperty("isError");
  });

  test("reminds once for each matching tool-call id", async () => {
    const handlers = loadHandlers();
    await handlers.get("tool_call")!(matchingCall as never, {} as never);
    expect(await handlers.get("tool_result")!(result as never, {} as never)).toBeDefined();
    expect(await handlers.get("tool_result")!(result as never, {} as never)).toBeUndefined();
  });

  test("does not modify an unrelated result", async () => {
    const handlers = loadHandlers();
    expect(await handlers.get("tool_result")!(result as never, {} as never)).toBeUndefined();
  });

  test("clears pending matches on shutdown", async () => {
    const handlers = loadHandlers();
    await handlers.get("tool_call")!(matchingCall as never, {} as never);
    await handlers.get("session_shutdown")!({ type: "session_shutdown" } as never, {} as never);
    expect(await handlers.get("tool_result")!(result as never, {} as never)).toBeUndefined();
  });

  test("also prepends to failed and image-first results", async () => {
    const handlers = loadHandlers();
    await handlers.get("tool_call")!(matchingCall as never, {} as never);
    const failed = {
      ...result,
      content: [{ type: "image", data: "AA==", mimeType: "image/png" }],
      isError: true,
    } as unknown as ToolResultEvent;
    expect(await handlers.get("tool_result")!(failed as never, {} as never)).toEqual({
      content: [{ type: "text", text: REMINDER }, ...failed.content],
    });
  });
});
```

- [ ] **Step 2: Run the extension tests and confirm the expected failure**

Run: `bun test test/extension.test.ts`

Expected: FAIL because `src/index.ts` does not exist.

- [ ] **Step 3: Implement lifecycle correlation and leading reminder content**

Create `src/index.ts`:

```ts
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { isPythonSymbolGrepCall } from "./detector";

export const REMINDER =
  "Python symbol search detected: use the LSP symbol/definition/references tools instead of grep/rg for Python code navigation.";

export default function pythonSymbolGrepReminder(pi: ExtensionAPI): void {
  const pending = new Set<string>();

  pi.on("tool_call", event => {
    try {
      if (isPythonSymbolGrepCall(event)) pending.add(event.toolCallId);
    } catch {
      // Fail open: a reminder extension must never prevent tool execution.
    }
  });

  pi.on("tool_result", event => {
    if (!pending.delete(event.toolCallId)) return;
    return {
      content: [{ type: "text" as const, text: REMINDER }, ...event.content],
    };
  });

  pi.on("session_shutdown", () => {
    pending.clear();
  });
}
```

The empty catch is intentional and narrowly scoped to classifier failure. It is not a substitute for detector validation; Task 1 covers malformed inputs directly.

- [ ] **Step 4: Run focused tests and LSP checks**

Run: `bun test test/extension.test.ts`

Expected: all extension tests PASS.

Use `lsp` diagnostics on `src/index.ts` and `test/extension.test.ts`, then use `lsp` references on exported `REMINDER` and `isPythonSymbolGrepCall` to confirm every callsite is understood.

Expected: no diagnostics; `REMINDER` is referenced by extension tests and `isPythonSymbolGrepCall` is referenced by `src/index.ts` plus detector tests.

- [ ] **Step 5: Commit the extension deliverable**

Run:

```bash
jj new -m "Add non-blocking LSP reminder extension"
```

Expected: extension and lifecycle tests are committed in the parent; the new working revision is empty.

### Task 3: Real Loader Smoke Test and Package Verification

**Files:**
- Create: `test/loader.test.ts`
- Modify only if diagnostics require it: `package.json`, `tsconfig.json`, `src/index.ts`, `src/detector.ts`

**Interfaces:**
- Consumes: package manifest `omp.extensions`, OMP `loadExtensions`, registered handler maps, and exported `REMINDER`.
- Produces: verified loadable package with end-to-end call/result behavior.

- [ ] **Step 1: Write a real OMP loader smoke test**

Create `test/loader.test.ts`:

```ts
import { expect, test } from "bun:test";
import path from "node:path";
import type { ExtensionContext, ToolCallEvent, ToolResultEvent } from "@oh-my-pi/pi-coding-agent";
import { loadExtensions } from "@oh-my-pi/pi-coding-agent";
import { REMINDER } from "../src/index";

const root = path.resolve(import.meta.dir, "..");

test("OMP loads the extension and prefixes a representative result", async () => {
  const loaded = await loadExtensions([path.join(root, "src/index.ts")], root);
  expect(loaded.errors).toEqual([]);
  expect(loaded.extensions).toHaveLength(1);

  const extension = loaded.extensions[0]!;
  const onCall = extension.handlers.get("tool_call")?.[0];
  const onResult = extension.handlers.get("tool_result")?.[0];
  expect(onCall).toBeDefined();
  expect(onResult).toBeDefined();

  const call = {
    type: "tool_call",
    toolCallId: "loader-smoke",
    toolName: "mcp__context_mode_ctx_execute",
    input: {
      language: "shell",
      code: String.raw`rg '^\s*def\s+load_user\(' --type py src`,
    },
  } as ToolCallEvent;
  const originalContent = [{ type: "text" as const, text: "src/users.py:10:def load_user(" }];
  const result = {
    type: "tool_result",
    toolCallId: call.toolCallId,
    toolName: call.toolName,
    input: call.input,
    content: originalContent,
    details: { indexed: true },
    isError: false,
  } as unknown as ToolResultEvent;
  const context = {} as ExtensionContext;

  await onCall!(call, context);
  const patch = await onResult!(result, context);
  expect(patch).toEqual({
    content: [{ type: "text", text: REMINDER }, ...originalContent],
  });
});
```

- [ ] **Step 2: Run the loader smoke test and diagnose any integration failure**

Run: `bun test test/loader.test.ts`

Expected: PASS; `loadExtensions` reports no errors and the context-mode call receives the leading reminder.

If it fails, use `lsp` definition/hover on `loadExtensions`, `Extension.handlers`, and the event types before changing code. Do not use grep for these symbols.

- [ ] **Step 3: Run complete verification**

Run through context-mode so large output stays out of the conversation:

```bash
bun test
bun run typecheck
bun pm pack --dry-run
```

Expected:

- all detector, lifecycle, and loader tests PASS;
- TypeScript reports zero diagnostics;
- package dry-run includes `package.json`, `src/index.ts`, and `src/detector.ts` and excludes tests/docs from runtime loading concerns.

Also run workspace `lsp` diagnostics over `src/**/*.ts` and `test/**/*.ts`.

Expected: zero errors.

- [ ] **Step 4: Review exported-symbol callsites with LSP**

Use `lsp` references for:

- `isPythonSymbolGrepCall` in `src/detector.ts`;
- `REMINDER` in `src/index.ts`;
- default `pythonSymbolGrepReminder` factory in `src/index.ts`.

Expected: every source/test callsite is listed; no unexpected or missing references.

- [ ] **Step 5: Commit the verified package**

Run:

```bash
jj new -m "Verify OMP Python symbol grep reminder plugin"
jj st
```

Expected: the loader test and any integration-only corrections are committed in the parent; the new working revision is empty.