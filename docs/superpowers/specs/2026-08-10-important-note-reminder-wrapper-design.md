# Important-Note Reminder Wrapper Design

## Goal

Make the agent-facing Python symbol-search reminder unambiguously important by enclosing the complete reminder in compact `<IMPORTANT-NOTE>...</IMPORTANT-NOTE>` tags.

## Behavior

The exported `REMINDER` value will be exactly:

```text
<IMPORTANT-NOTE>Python symbol search detected: use the LSP symbol/definition/references tools instead of grep/rg for Python code navigation.</IMPORTANT-NOTE>
```

The extension will continue to prepend one text content item containing `REMINDER` to each matching tool result. Original result content, matching behavior, session counters, notifications, error handling, and shutdown cleanup remain unchanged.

## Implementation

Update the existing `REMINDER` constant in `src/index.ts`. Do not add a formatter or wrap the value at the delivery site: the exported constant is the public reminder payload and is already shared by every delivery path and loader test.

Add a regression assertion that checks the exact wrapped literal. Existing extension and loader tests continue to verify delivery ordering and unchanged original content.

## Verification

Run the focused extension and loader tests, the full Bun test suite, and TypeScript type checking.
