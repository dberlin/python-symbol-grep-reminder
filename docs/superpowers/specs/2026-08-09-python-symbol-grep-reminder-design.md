# Python Symbol Grep Reminder Design

## Goal

Provide an OMP extension that notices a conservative subset of `grep` and `rg` searches used for Python symbol or function navigation. The search still runs. Its tool result is prefixed with a short reminder to use OMP's LSP symbol, definition, and references operations instead.

The detector favors low false-positive rates over complete coverage. It only needs to remind a model often enough to discourage grep-based Python code navigation over time.

## Intervention

The extension registers `tool_call` and `tool_result` handlers.

During `tool_call`, it classifies the input without changing or blocking it. Matching tool-call IDs are retained until their corresponding results arrive. During `tool_result`, a matching result receives a new leading text content block containing:

> Python symbol search detected: use the LSP symbol/definition/references tools instead of grep/rg for Python code navigation.

The original content array follows the reminder unchanged. Original content ordering, structured details, and error state remain intact. The remembered ID is removed after the result is handled.

## Detection Threshold

A call matches only when all three categories are present:

1. **Search executable:** an actual `grep` or `rg` invocation, or the built-in `grep` tool.
2. **Python evidence:** a `.py` path or glob, `--type py`, `-tpy`, or Python declaration syntax in the search pattern.
3. **Symbol/function evidence:** a search pattern shaped like a Python declaration, callable, decorator, or an equivalent escaped regular expression. Examples include `def name`, `async def name`, `class Name`, `name(`, and `@decorator`.

Generic searches remain unflagged. Examples include `rg TODO -tpy`, log/error searches, package names, version strings, prose, and searches without explicit Python evidence.

The classifier is deterministic. It does not inspect conversation history, invoke a model, infer user intent, or maintain behavior across sessions.

## Supported Tool Surfaces

The detector extracts candidate search text from:

- the built-in `grep` tool;
- shell-like tool inputs containing `grep` or `rg` commands;
- context-mode `ctx_execute` and `ctx_batch_execute` payloads;
- context-mode calls mounted through `write` to `xd://mcp__context_mode_*`, where the JSON `content` field contains nested execution arguments.

Nested context-mode payload parsing is bounded and fail-open. Malformed or unfamiliar payloads are ignored rather than blocking tools or failing the session.

## Package Structure

- `src/index.ts`: OMP extension factory and tool lifecycle correlation.
- `src/detector.ts`: side-effect-free extraction and classification functions.
- `test/detector.test.ts`: table-driven direct, shell, and context-mode detector fixtures.
- `test/extension.test.ts`: result-prefix behavior and tool-call correlation fixtures.
- `package.json`: package metadata, scripts, and `omp.extensions` entry.
- `tsconfig.json`: strict TypeScript checking for source and tests.

The package targets the installed OMP extension API and Bun runtime. No runtime dependency is required beyond the host-provided `@oh-my-pi/pi-coding-agent` API.

## Error Handling

- Detector parsing never throws into `tool_call`; unknown input shapes return no match.
- JSON embedded in mounted context-mode writes is parsed only when the path identifies a context-mode execution device.
- Tool calls are never blocked or rewritten.
- Matching failed tool executions still receive the reminder because the attempted navigation method is the behavior being corrected.
- Correlation state is cleared as each matching result arrives and on session shutdown.

## Verification

Table-driven tests cover:

- direct built-in grep calls with Python declaration/function patterns;
- shell `grep` and `rg` calls with quoting, Python globs, and type flags;
- direct and mounted context-mode execution payloads;
- malformed nested payloads;
- generic Python text searches and non-Python symbol searches;
- commands that merely mention grep/rg in prose;
- result prefixing with and without an existing text block;
- preservation of result content, details, and error state;
- one reminder per matching tool-call ID and correlation cleanup.

A smoke test loads the extension through OMP's extension loader and exercises a representative matching tool call end to end.