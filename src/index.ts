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
