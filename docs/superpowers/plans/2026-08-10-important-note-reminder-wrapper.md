# Important-Note Reminder Wrapper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enclose every delivered Python symbol-search reminder in compact `<IMPORTANT-NOTE>...</IMPORTANT-NOTE>` tags.

**Architecture:** Keep the existing delivery pipeline unchanged. Update the exported `REMINDER` constant, which is already the single payload used by extension and loader paths, and lock its exact value with a regression assertion.

**Tech Stack:** TypeScript, Bun test runner, TypeScript compiler, Jujutsu.

## Global Constraints

- The exact payload is `<IMPORTANT-NOTE>Python symbol search detected: use the LSP symbol/definition/references tools instead of grep/rg for Python code navigation.</IMPORTANT-NOTE>`.
- Preserve matching, prepending order, original tool-result content, observability, failure handling, and shutdown behavior.
- Add no formatter, helper, dependency, compatibility alias, or alternate reminder path.

---

### Task 1: Wrap the reminder payload

**Files:**
- Modify: `test/extension.test.ts:37-49`
- Modify: `src/index.ts:4-5`

**Interfaces:**
- Consumes: the existing exported `REMINDER: string` constant and `tool_result` handler.
- Produces: the same exported `REMINDER: string` interface with the exact tagged payload; no caller changes.

- [ ] **Step 1: Start the implementation revision**

Run:

```bash
jj new -m "Wrap reminder in important-note tags"
```

Expected: a new empty working-copy revision above the plan revision.

- [ ] **Step 2: Write the failing delivered-payload test**

In `test/extension.test.ts`, rename the first test to:

```ts
test("prepends a tagged reminder and leaves original content untouched", async () => {
```

Then replace that test's patch expectation with an independently derived literal:

```ts
expect(patch).toEqual({
  content: [
    {
      type: "text",
      text: "<IMPORTANT-NOTE>Python symbol search detected: use the LSP symbol/definition/references tools instead of grep/rg for Python code navigation.</IMPORTANT-NOTE>",
    },
    ...result.content,
  ],
});
```

Keep the assertions that the original result is untouched and that no unrelated result fields are returned.

- [ ] **Step 3: Run the focused test and confirm the contract fails**

Run:

```bash
bun test test/extension.test.ts
```

Expected: FAIL in `prepends a tagged reminder and leaves original content untouched`; the received first content item lacks the opening and closing tags. Existing tests should remain passing.

- [ ] **Step 4: Implement the minimal payload change**

Replace the `REMINDER` declaration in `src/index.ts` with:

```ts
export const REMINDER =
  "<IMPORTANT-NOTE>Python symbol search detected: use the LSP symbol/definition/references tools instead of grep/rg for Python code navigation.</IMPORTANT-NOTE>";
```

Do not change the `tool_result` handler: it already prepends `REMINDER` as one text item.

- [ ] **Step 5: Run focused delivery verification**

Run:

```bash
bun test test/extension.test.ts test/loader.test.ts
```

Expected: all extension and loader tests pass, including exact payload, prepending, failed-result, and installed-loader coverage.

- [ ] **Step 6: Smoke-test the exported runtime payload**

Run:

```bash
bun -e 'import { REMINDER } from "./src/index.ts"; console.log(REMINDER)'
```

Expected output:

```text
<IMPORTANT-NOTE>Python symbol search detected: use the LSP symbol/definition/references tools instead of grep/rg for Python code navigation.</IMPORTANT-NOTE>
```

- [ ] **Step 7: Run complete verification**

Run:

```bash
bun test
bun run typecheck
```

Expected: the full suite passes and TypeScript exits with status 0.

- [ ] **Step 8: Verify the Jujutsu revision**

Run:

```bash
jj st
```

Expected: only `src/index.ts` and `test/extension.test.ts` are changed in the described `Wrap reminder in important-note tags` revision; no conflicts or unrelated files.
