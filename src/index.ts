import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { isPythonSymbolGrepCall } from "./detector";

export const REMINDER =
  "Python symbol search detected: use the LSP symbol/definition/references tools instead of grep/rg for Python code navigation.";

export default function pythonSymbolGrepReminder(pi: ExtensionAPI): void {
  const pending = new Set<string>();
  let sessionTotal = 0;

  pi.on("tool_call", event => {
    try {
      if (isPythonSymbolGrepCall(event)) pending.add(event.toolCallId);
    } catch {
      // Fail open: a reminder extension must never prevent tool execution.
    }
  });

  pi.on("tool_result", (event, context) => {
    if (!pending.delete(event.toolCallId)) return;

    sessionTotal++;
    try {
      pi.appendEntry("python-symbol-grep-reminder", {
        timestamp: Date.now(),
        toolName: event.toolName,
        toolCallId: event.toolCallId,
        sessionTotal,
      });
    } catch {
      // Observability must never prevent reminder delivery.
    }

    try {
      if (context.hasUI) {
        context.ui.notify(`Python symbol grep reminder sent · session total: ${sessionTotal}`, "info");
      }
    } catch {
      // Observability must never prevent reminder delivery.
    }

    return {
      content: [{ type: "text" as const, text: REMINDER }, ...event.content],
    };
  });

  pi.on("session_shutdown", () => {
    pending.clear();
    sessionTotal = 0;
  });
}
