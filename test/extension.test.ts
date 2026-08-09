import { describe, expect, test } from "bun:test";
import type { ExtensionAPI, ToolCallEvent, ToolResultEvent } from "@oh-my-pi/pi-coding-agent";
import extension, { REMINDER } from "../src/index";

type Handler = (event: never, context: never) => unknown;

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
