import { describe, expect, test } from "bun:test";
import type { ExtensionAPI, ToolCallEvent, ToolResultEvent } from "@oh-my-pi/pi-coding-agent";
import extension, { REMINDER } from "../src/index";

type Handler = (event: never, context: never) => unknown;

function loadHandlers(apiOverrides: Partial<ExtensionAPI> = {}): Map<string, Handler> {
  const handlers = new Map<string, Handler>();
  const pi = {
    appendEntry() {},
    ...apiOverrides,
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
  test("prepends a tagged reminder and leaves original content untouched", async () => {
    const handlers = loadHandlers();
    await handlers.get("tool_call")!(matchingCall as never, {} as never);
    const patch = await handlers.get("tool_result")!(result as never, {} as never);

    expect(patch).toEqual({
      content: [
        {
          type: "text",
          text: "<IMPORTANT-NOTE>Python symbol search detected: use the LSP symbol/definition/references tools instead of grep/rg for Python code navigation.</IMPORTANT-NOTE>",
        },
        ...result.content,
      ],
    });
    expect(result.content).toEqual([{ type: "text", text: "src/users.py:10:def load_user(" }]);
    expect(patch).not.toHaveProperty("details");
    expect(patch).not.toHaveProperty("isError");
  });

  test("records and announces every delivered reminder", async () => {
    const entries: Array<{ customType: string; data: unknown }> = [];
    const notifications: Array<{ message: string; type: string | undefined }> = [];
    const handlers = loadHandlers({
      appendEntry(customType: string, data?: unknown) {
        entries.push({ customType, data });
      },
    } as Partial<ExtensionAPI>);
    const context = {
      hasUI: true,
      ui: {
        notify(message: string, type?: "info" | "warning" | "error") {
          notifications.push({ message, type });
        },
      },
    };
    const secondCall = { ...matchingCall, toolCallId: "call-2" } as ToolCallEvent;
    const secondResult = { ...result, toolCallId: "call-2" } as ToolResultEvent;

    await handlers.get("tool_call")!(matchingCall as never, context as never);
    await handlers.get("tool_result")!(result as never, context as never);
    await handlers.get("tool_call")!(secondCall as never, context as never);
    await handlers.get("tool_result")!(secondResult as never, context as never);

    expect(entries).toEqual([
      {
        customType: "python-symbol-grep-reminder",
        data: {
          timestamp: expect.any(Number),
          toolName: "grep",
          toolCallId: "call-1",
          sessionTotal: 1,
        },
      },
      {
        customType: "python-symbol-grep-reminder",
        data: {
          timestamp: expect.any(Number),
          toolName: "grep",
          toolCallId: "call-2",
          sessionTotal: 2,
        },
      },
    ]);
    expect(notifications).toEqual([
      { message: "Python symbol grep reminder sent · session total: 1", type: "info" },
      { message: "Python symbol grep reminder sent · session total: 2", type: "info" },
    ]);
  });

  test("keeps reminder delivery when observability sinks fail", async () => {
    let appendAttempts = 0;
    let notifyAttempts = 0;
    const handlers = loadHandlers({
      appendEntry() {
        appendAttempts++;
        throw new Error("session storage unavailable");
      },
    } as Partial<ExtensionAPI>);
    const context = {
      hasUI: true,
      ui: {
        notify() {
          notifyAttempts++;
          throw new Error("UI unavailable");
        },
      },
    };

    await handlers.get("tool_call")!(matchingCall as never, context as never);
    const patch = await handlers.get("tool_result")!(result as never, context as never);

    expect(appendAttempts).toBe(1);
    expect(notifyAttempts).toBe(1);
    expect(patch).toEqual({
      content: [{ type: "text", text: REMINDER }, ...result.content],
    });
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
