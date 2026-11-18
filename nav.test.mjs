import assert from "node:assert/strict"
import test from "node:test"
import {
  extractPromptText,
  indexFromPointer,
  isUserMessage,
  mergePrompts,
  nextCursor,
  nextIndex,
  pickActiveIdAtLine,
  shouldShowRail,
  toPrompt,
  truncate,
  railSpan,
  unwrapList,
  yForIndex,
} from "./nav.mjs"

test("unwrapList reads data arrays", () => {
  assert.deepEqual(unwrapList({ data: [{ id: "a" }] }), [{ id: "a" }])
  assert.deepEqual(unwrapList([{ id: "b" }]), [{ id: "b" }])
  assert.deepEqual(unwrapList({ messages: [{ id: "c" }] }), [{ id: "c" }])
  assert.deepEqual(unwrapList(null), [])
})

test("isUserMessage matches type and role", () => {
  assert.equal(isUserMessage({ type: "user" }), true)
  assert.equal(isUserMessage({ role: "user" }), true)
  assert.equal(isUserMessage({ type: "assistant" }), false)
})

test("extractPromptText prefers text then parts", () => {
  assert.equal(extractPromptText({ text: " hello " }), " hello ")
  assert.equal(extractPromptText({ parts: [{ type: "text", text: "one" }, { text: "two" }] }), "one\ntwo")
  assert.equal(extractPromptText({ summary: { title: "short" } }), "short")
})

test("mergePrompts keeps first order and fills empty text", () => {
  const merged = mergePrompts([
    [{ id: "a", type: "user", text: "" }, { id: "b", type: "user", text: "b" }],
    [{ id: "a", type: "user", text: "filled" }, { id: "c", type: "user", text: "c" }],
  ])
  assert.deepEqual(
    merged.map((item) => item.id),
    ["a", "b", "c"],
  )
  assert.equal(merged[0].text, "filled")
})

test("toPrompt ignores items without ids", () => {
  assert.equal(toPrompt({ text: "no" }), null)
  assert.equal(toPrompt({ id: "x", text: "yes" }).id, "x")
})

test("indexFromPointer maps the rail to prompt indexes", () => {
  assert.equal(indexFromPointer(0, 0, 100, 5), 0)
  assert.equal(indexFromPointer(100, 0, 100, 5), 4)
  assert.equal(indexFromPointer(50, 0, 100, 5), 2)
})

test("yForIndex spaces prompts evenly", () => {
  assert.equal(yForIndex(0, 3, 10, 90), 10)
  assert.equal(yForIndex(2, 3, 10, 90), 100)
})

test("pickActiveIdAtLine prefers the prompt under the reading line", () => {
  const prompts = [{ id: "a" }, { id: "b" }, { id: "c" }]
  const visible = [
    { id: "a", top: 0, bottom: 40 },
    { id: "b", top: 80, bottom: 140 },
  ]
  assert.equal(pickActiveIdAtLine(prompts, visible, 20), "a")
  assert.equal(pickActiveIdAtLine(prompts, visible, 90), "b")
  assert.equal(pickActiveIdAtLine(prompts, visible, 60), "a")
})

test("truncate keeps short text and ellipsizes long text", () => {
  assert.equal(truncate("  hi there  "), "hi there")
  assert.equal(truncate("abcdefghij", 8), "abcdefg…")
})

test("shouldShowRail hides on narrow or short sessions", () => {
  assert.equal(shouldShowRail(3, 2, true, false), true)
  assert.equal(shouldShowRail(1, 2, true, false), false)
  assert.equal(shouldShowRail(5, 2, false, false), false)
  assert.equal(shouldShowRail(5, 2, true, true), false)
})

test("nextIndex steps within bounds", () => {
  const prompts = [{ id: "a" }, { id: "b" }, { id: "c" }]
  assert.equal(nextIndex(prompts, "b", -1), 0)
  assert.equal(nextIndex(prompts, "a", -1), 0)
  assert.equal(nextIndex(prompts, "c", 1), 2)
  assert.equal(nextIndex(prompts, undefined, 1), 0)
})

test("nextCursor follows the next page only", () => {
  assert.equal(nextCursor({ cursor: { next: "n1" } }), "n1")
  assert.equal(nextCursor({ cursor: { previous: "p1" } }), undefined)
  assert.equal(nextCursor({}), undefined)
})

test("railSpan keeps the base length until node gaps would drop below minGap", () => {
  assert.equal(railSpan(1, 200, 18), 200)
  assert.equal(railSpan(5, 200, 18), 200)
  assert.equal(railSpan(12, 200, 18), 200)
  assert.equal(railSpan(13, 200, 18), 12 * 18)
  assert.equal(railSpan(20, 200, 18), 19 * 18)
})
