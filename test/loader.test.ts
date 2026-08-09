import { expect, test } from "bun:test";
import path from "node:path";
import type { ExtensionContext, ToolCallEvent, ToolResultEvent } from "@oh-my-pi/pi-coding-agent";
import { discoverExtensionPaths, loadExtensions } from "@oh-my-pi/pi-coding-agent";
import { REMINDER } from "../src/index";

const root = path.resolve(import.meta.dir, "..");

test("OMP loads the extension and prefixes a representative result", async () => {
  const extensionPaths = await discoverExtensionPaths([root], root, [], { ambient: false });
  expect(extensionPaths).toEqual([path.join(root, "src/index.ts")]);
  const loaded = await loadExtensions(extensionPaths, root);
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
