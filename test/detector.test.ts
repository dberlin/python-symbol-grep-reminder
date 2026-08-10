import { describe, expect, test } from "bun:test";
import { isPythonSymbolGrepCall, type ToolCallLike } from "../src/detector";

const positive: Array<[string, ToolCallLike]> = [
  [
    "built-in grep for a Python function declaration",
    { toolName: "grep", input: { pattern: String.raw`^\s*def\s+load_user\(`, path: "src/**/*.py" } },
  ],
  [
    "built-in grep for Python function definitions",
    { toolName: "grep", input: { pattern: String.raw`^\s*(?:async\s+)?def\s+`, path: "src/**/*.py" } },
  ],
  [
    "built-in grep for Python function definitions from the repository root",
    {
      toolName: "grep",
      input: {
        pattern: String.raw`^\s*(?:async\s+)?def\s+[A-Za-z_]\w*\s*\(`,
        path: ".",
      },
    },
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
    "grep shell command scoped by Python include",
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
    "direct context-mode execute-file",
    {
      toolName: "mcp__context_mode_ctx_execute_file",
      input: {
        path: "src/users.py",
        language: "javascript",
        code: String.raw`execSync("rg '\\bload_user\\s*\\(' src")`,
      },
    },
  ],
  [
    "context-mode JavaScript execSync",
    {
      toolName: "mcp__context_mode_ctx_execute",
      input: {
        language: "javascript",
        code: String.raw`const output = execSync("rg '@cached_property' -g '*.py' src");`,
      },
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
  [
    "mounted context-mode execute-file write",
    {
      toolName: "write",
      input: {
        path: "xd://mcp__context_mode_ctx_execute_file",
        content: JSON.stringify({
          path: "src/users.py",
          language: "shell",
          code: String.raw`rg '^\\s*class\\s+User:' src`,
        }),
      },
    },
  ],
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
];

const negative: Array<[string, ToolCallLike]> = [
  ["generic Python TODO search", { toolName: "grep", input: { pattern: "TODO", path: "src/**/*.py" } }],
  ["bare identifier in Python", { toolName: "grep", input: { pattern: "load_user", path: "src/**/*.py" } }],
  [
    "def prose outside Python",
    { toolName: "grep", input: { pattern: "the def keyword", path: "docs/**/*.md" } },
  ],
  [
    "function shape outside Python",
    { toolName: "grep", input: { pattern: String.raw`loadUser\(`, path: "src/**/*.ts" } },
  ],
  ["Python prose search", { toolName: "bash", input: { command: "rg 'connection failed' --type py" } }],
  ["command that only prints grep prose", { toolName: "bash", input: { command: "printf 'use rg def foo in *.py'" } }],
  [
    "replacement text after a generic rg pattern",
    { toolName: "bash", input: { command: String.raw`rg TODO -tpy --replace 'load_user(' src` } },
  ],
  [
    "replacement text before a generic rg pattern",
    { toolName: "bash", input: { command: String.raw`rg --replace 'load_user(' TODO -tpy src` } },
  ],
  [
    "non-context mounted write",
    { toolName: "write", input: { path: "notes.txt", content: "rg 'def foo' -g '*.py'" } },
  ],
  [
    "malformed mounted payload",
    { toolName: "write", input: { path: "xd://mcp__context_mode_ctx_execute", content: "{" } },
  ],
  [
    "unrelated custom tool prose",
    { toolName: "summarize", input: { prompt: "Run rg '^def foo' against *.py" } },
  ],
  [
    "context-mode code that mentions a command without executing it",
    {
      toolName: "mcp__context_mode_ctx_execute",
      input: { language: "javascript", code: "console.log(\"use rg '^def foo' -g '*.py' instead\")" },
    },
  ],
  [
    "context-mode JavaScript template containing a shell example",
    {
      toolName: "mcp__context_mode_ctx_execute",
      input: {
        language: "javascript",
        code: "const example = `\nrg '^def foo\\(' -g '*.py'\n`;\nconsole.log(example);",
      },
    },
  ],
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
];

describe("isPythonSymbolGrepCall", () => {
  test.each(positive)("detects %s", (_name, call) => {
    expect(isPythonSymbolGrepCall(call)).toBe(true);
  });

  test.each(negative)("ignores %s", (_name, call) => {
    expect(isPythonSymbolGrepCall(call)).toBe(false);
  });
});
