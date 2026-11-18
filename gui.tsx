/** @jsxImportSource solid-js */
import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { Portal } from "solid-js/web"
import { Schema } from "effect"
import {
  Command,
  Plugin,
  SettingsPage,
  Slot,
  Store,
  Style,
  createKeyed,
  type Command as CommandItem,
} from "@opencode/plugin/gui"
import {
  extractPromptText,
  indexFromPointer,
  isUserMessage,
  mergePrompts,
  nextCursor,
  nextIndex,
  pickActiveIdAtLine,
  shouldShowRail,
  truncate,
  unwrapList,
  railSpan,
  yForIndex,
} from "./nav.mjs"

const MIN_PROMPTS = 1
const RAIL_FRACTION = 0.2
const MIN_NODE_GAP = 18
const CSS = `
.ocpn-host { position:fixed; inset:0; pointer-events:none; z-index:120; }
.ocpn-rail {
  position:fixed; width:22px; pointer-events:auto; touch-action:none;
  display:flex; justify-content:center; user-select:none; -webkit-user-select:none;
}
.ocpn-rail[data-side="left"] { transform: none; }
.ocpn-rail[data-side="right"] { transform: none; }
.ocpn-track {
  position:absolute; top:8px; bottom:8px; width:2px; border-radius:99px;
  background: color-mix(in srgb, var(--v2-icon-icon-faint, #8a8f98) 70%, transparent);
}
.ocpn-thumb {
  position:absolute; left:50%; width:10px; height:10px; margin:-5px 0 0 -5px; border-radius:50%;
  background: var(--v2-icon-icon-base, #eceff3);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--v2-icon-icon-base, #eceff3) 18%, transparent);
  pointer-events:none; opacity:.9;
}
.ocpn-dot {
  position:absolute; left:50%; width:22px; height:20px; margin:-10px 0 0 -11px;
  display:flex; align-items:center; justify-content:center;
  background:none; border:0; padding:0; cursor:pointer;
  text-decoration:none; color:inherit; box-sizing:border-box;
}
.ocpn-dot i {
  display:block; width:7px; height:7px; border-radius:50%;
  background: color-mix(in srgb, var(--v2-icon-icon-muted, #9aa0a8) 92%, transparent);
  transition: transform .12s ease, width .12s ease, height .12s ease, background .12s ease;
}
.ocpn-dot[data-active] i {
  width:8px; height:8px;
  background: var(--v2-icon-icon-base, #eceff3);
}
.ocpn-dot:hover i, .ocpn-dot:focus-visible i {
  width:10px; height:10px;
  background: var(--v2-icon-icon-base, #eceff3);
  transform: scale(1.05);
}
.ocpn-rail.is-dragging .ocpn-dot i { transition:none; }
.ocpn-tip {
  position:fixed; z-index:50; max-width:280px; pointer-events:none;
  padding:8px 10px; border-radius:8px;
  background: var(--surface-raised-stronger-non-alpha, var(--v2-background-bg-raised, #1b1d21));
  color: var(--v2-text-text-base, #eceff3);
  box-shadow:
    0 0 0 1px var(--v2-border-border-base, rgba(255,255,255,.08)),
    0 8px 24px rgba(0,0,0,.28);
  font-size:12px; line-height:1.4; white-space:pre-wrap; word-break:break-word;
}
.ocpn-tip b { display:block; font-size:11px; font-weight:600; margin-bottom:4px;
  color: var(--v2-text-text-muted, #9aa0a8); }
.ocpn-jump { display:flex; flex-direction:column; gap:4px; max-height:360px; overflow:auto; min-width:280px; }
.ocpn-jump button {
  display:block; width:100%; text-align:left; border:0; cursor:pointer;
  background:transparent; color: inherit; padding:8px 10px; border-radius:8px;
  font: inherit; font-size:13px; line-height:1.35;
}
.ocpn-jump button[data-active] { background: var(--surface-base-active, rgba(255,255,255,.08)); }
.ocpn-jump button:hover { background: var(--surface-base, rgba(255,255,255,.06)); }
.ocpn-jump small { display:block; color: var(--v2-text-text-muted, #9aa0a8); font-size:11px; margin-bottom:2px; }
@media (prefers-reduced-motion: reduce) {
  .ocpn-dot i { transition:none; }
}
`

type Prompt = { id: string; text: string }
type Rect = { left: number; right: number; top: number; bottom: number; height: number }
type NavApi = {
  prompts: () => Prompt[]
  setPrompts: (value: Prompt[]) => void
  active: () => string | undefined
  setActive: (value: string | undefined) => void
  jump: (id: string) => void
  step: (delta: number) => boolean
  refresh: () => void
}

function isShown(node: Element) {
  if (!(node instanceof HTMLElement) || node.hidden) return false
  const style = window.getComputedStyle(node)
  if (style.display === "none" || style.visibility === "hidden") return false
  const rect = node.getBoundingClientRect()
  return rect.width > 1 && rect.height > 1
}

function overflowY(node: Element) {
  const value = window.getComputedStyle(node).overflowY
  return value === "auto" || value === "scroll" || value === "overlay"
}

function findScroller() {
  const viewports = Array.from(document.querySelectorAll<HTMLElement>(".scroll-view__viewport, [data-scrollable]")).filter(
    (node) => isShown(node) && node.querySelector("[data-timeline-key], [data-message-id], [data-timeline-row]"),
  )
  const overflowing = viewports.find((node) => node.scrollHeight > node.clientHeight + 1)
  if (overflowing) return overflowing
  if (viewports[0]) return viewports[0]

  const nodes = Array.from(document.querySelectorAll("[data-timeline-key], [data-message-id], [data-timeline-row]")).filter(
    isShown,
  )
  const start = nodes[0]
  if (start) {
    let node: HTMLElement | null = start.parentElement
    let fallback: HTMLElement | undefined
    while (node && node !== document.body) {
      if (overflowY(node) || node.hasAttribute("data-scrollable") || node.classList.contains("scroll-view__viewport")) {
        if (node.scrollHeight > node.clientHeight + 1) return node
        fallback ??= node
      }
      node = node.parentElement
    }
    if (fallback) return fallback
  }
  return undefined
}

function isDocumentScroller(scroller: HTMLElement) {
  return scroller === document.scrollingElement || scroller === document.documentElement
}

function visibleRect(scroller: HTMLElement): Rect | undefined {
  const documentScroller = isDocumentScroller(scroller)
  const box = documentScroller
    ? { left: 0, right: window.innerWidth, top: 0, bottom: window.innerHeight, width: window.innerWidth }
    : scroller.getBoundingClientRect()
  const composer = Array.from(document.querySelectorAll("[data-component='composer']")).find(isShown)
  let bottom = box.bottom
  if (composer) {
    const composerBox = composer.getBoundingClientRect()
    if (composerBox.top < bottom && composerBox.bottom > box.top) bottom = Math.min(bottom, composerBox.top)
  }
  const top = documentScroller ? 96 : box.top + 52
  if (bottom - top < 60 || box.width < 160) return undefined
  const fullHeight = bottom - top
  return { left: box.left, right: box.right, top, bottom, height: fullHeight }
}

function compactRect(full: Rect, count: number): Rect {
  const base = Math.max(72, full.height * RAIL_FRACTION)
  const height = Math.min(full.height, railSpan(count, base, MIN_NODE_GAP))
  const top = full.top + (full.height - height) / 2
  return { left: full.left, right: full.right, top, bottom: top + height, height }
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

// Markdown, mentions and whitespace can differ between the API text and the rendered row, so compare
// the opening words rather than demanding an exact match.
function looseMatch(body: string, needle: string) {
  if (!body || !needle) return false
  if (body.includes(needle)) return true
  const head = needle.slice(0, 24)
  if (head.length >= 10 && body.includes(head)) return true
  const words = needle.split(" ").slice(0, 4).join(" ")
  return words.length >= 10 && body.includes(words)
}

function messageElement(id: string, text?: string) {
  const escaped = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(id) : id.replace(/"/g, '\\"')
  const byID = document.getElementById(`message-${id}`) || document.querySelector(`[id="message-${escaped}"]`)
  if (byID) return byID
  const byKey = Array.from(document.querySelectorAll("[data-timeline-key]")).find((node) =>
    (node.getAttribute("data-timeline-key") || "").includes(id),
  )
  if (byKey) return byKey
  const byData = Array.from(document.querySelectorAll(`[data-message-id="${escaped}"]`)).find(
    (node) => node.getAttribute("data-message-id") === id,
  )
  if (byData) return byData

  const needle = normalizeText(text || "").slice(0, 48)
  if (needle.length < 8) return undefined

  const rows = Array.from(
    document.querySelectorAll<HTMLElement>(
      '[data-timeline-row="UserMessage"], [data-timeline-row="UserPart"], [data-timeline-row="user-message"], [data-timeline-row="user-part"], [data-timeline-row]',
    ),
  )
  const preferred = rows.filter((node) => /user/i.test(node.getAttribute("data-timeline-row") || ""))
  const pool = preferred.length ? preferred : rows
  for (const node of pool) {
    if (looseMatch(normalizeText(node.innerText || ""), needle)) {
      const keyed = node.closest("[data-timeline-key]") || node
      return keyed instanceof HTMLElement ? keyed : node
    }
  }

  const parts = Array.from(
    document.querySelectorAll<HTMLElement>('[data-component="text-part"], [data-slot="text-part-body"]'),
  )
  for (const node of parts) {
    if (node.closest('[data-timeline-row="AssistantPart"], [data-slot="session-turn-assistant-content"]')) continue
    if (looseMatch(normalizeText(node.innerText || ""), needle)) {
      const keyed = node.closest("[data-timeline-key]") || node.closest("[data-timeline-row]") || node
      return keyed instanceof HTMLElement ? keyed : node
    }
  }
  return undefined
}

function messageIDOf(node: Element) {
  const key = node.getAttribute("data-timeline-key") || ""
  const match = key.match(/msg_[A-Za-z0-9]+/)
  if (match) return match[0]
  return node.getAttribute("data-message-id") || undefined
}

function visibleMessageRects(scroller: HTMLElement) {
  const nodes = Array.from(scroller.querySelectorAll<HTMLElement>("[data-timeline-key], [data-message-id]"))
  const seen = new Set<string>()
  return nodes.flatMap((node) => {
    const id = messageIDOf(node)
    if (!id || seen.has(id)) return []
    seen.add(id)
    const rect = node.getBoundingClientRect()
    if (rect.height < 1) return []
    return [{ id, top: rect.top, bottom: rect.bottom }]
  })
}

function delay(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms))
}

function quickFind(id: string) {
  const escaped = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(id) : id
  if (document.getElementById(`message-${id}`)) return true
  if (document.querySelector(`[id="message-${escaped}"]`)) return true
  return !!document.querySelector(`[data-timeline-key*="${escaped}"], [data-message-id="${escaped}"]`)
}

// Every element that may carry the conversation scroll offset. The timeline sometimes nests its own
// scroller inside `.scroll-view__viewport`, so collect all of them instead of trusting one.
function scrollHosts(from: HTMLElement): HTMLElement[] {
  const hosts: HTMLElement[] = []
  const add = (node: Element | null | undefined) => {
    if (!(node instanceof HTMLElement) || hosts.includes(node)) return
    if (node === document.body || node === document.documentElement) return
    if (!isShown(node) || node.scrollHeight <= node.clientHeight + 2) return
    const style = window.getComputedStyle(node)
    const scrollable =
      /(auto|scroll|overlay)/.test(style.overflowY) ||
      node.hasAttribute("data-scrollable") ||
      node.classList.contains("scroll-view__viewport")
    if (!scrollable) return
    hosts.push(node)
  }
  let node: HTMLElement | null = from
  while (node && node !== document.body) {
    add(node)
    node = node.parentElement
  }
  document.querySelectorAll(".scroll-view__viewport, [data-scrollable]").forEach(add)
  const doc = document.scrollingElement
  if (doc instanceof HTMLElement && doc.scrollHeight > doc.clientHeight + 2) hosts.push(doc)
  return hosts
}

function hostMax(host: HTMLElement) {
  if (isDocumentScroller(host)) return Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
  return Math.max(0, host.scrollHeight - host.clientHeight)
}

function hostTop(host: HTMLElement) {
  return isDocumentScroller(host) ? window.scrollY : host.scrollTop
}

function setHostTop(host: HTMLElement, top: number) {
  const next = Math.max(0, Math.min(top, hostMax(host)))
  if (isDocumentScroller(host)) window.scrollTo(0, next)
  else host.scrollTop = next
}

// Chat panes often keep following the output and yank a programmatic scroll back to the bottom.
// A synthetic wheel tells them the reader is taking over, and also wakes lazy history loaders.
function nudgeWheel(host: HTMLElement, deltaY: number) {
  const box = host.getBoundingClientRect()
  const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
  const target = hit instanceof HTMLElement ? hit : host
  try {
    target.dispatchEvent(new WheelEvent("wheel", { deltaY, bubbles: true }))
  } catch {
    /* older engines without WheelEvent */
  }
}

function releaseStick(host: HTMLElement) {
  nudgeWheel(host, -160)
}

function viewportBox(scroller: HTMLElement) {
  if (isDocumentScroller(scroller)) return { top: 0, bottom: window.innerHeight }
  const box = scroller.getBoundingClientRect()
  return { top: box.top, bottom: box.bottom }
}

// Bring an already rendered row into view and keep it there, re-applying if the timeline snaps back.
async function pinPrompt(scroller: HTMLElement, prompt: Prompt, hosts: HTMLElement[]) {
  for (let attempt = 0; attempt < 16; attempt++) {
    const node = messageElement(prompt.id, prompt.text)
    if (!(node instanceof HTMLElement)) return false
    const box = viewportBox(scroller)
    const rect = node.getBoundingClientRect()
    if (rect.bottom > box.top + 6 && rect.top < box.bottom - 32) return true

    node.scrollIntoView({ block: "center", behavior: "auto" })
    await delay(40)

    const after = node.getBoundingClientRect()
    if (after.bottom > box.top + 6 && after.top < box.bottom - 32) return true

    const delta = after.top - (box.top + Math.max(56, (box.bottom - box.top) * 0.22))
    for (const host of hosts) setHostTop(host, hostTop(host) + delta)
    await delay(60)
  }
  const node = messageElement(prompt.id, prompt.text)
  if (!(node instanceof HTMLElement)) return false
  const box = viewportBox(scroller)
  const rect = node.getBoundingClientRect()
  return rect.bottom > box.top && rect.top < box.bottom
}

// A smooth `scroll-behavior` makes scripted jumps lag behind and fight repeated corrections, so pin it
// to instant for the duration of a jump.
function freezeSmooth(hosts: HTMLElement[]) {
  const nodes = [document.documentElement, ...hosts]
  const saved = nodes.map((node) => [node, node.style.scrollBehavior] as const)
  for (const node of nodes) node.style.scrollBehavior = "auto"
  return () => {
    for (const [node, value] of saved) node.style.scrollBehavior = value
  }
}

// Walk forward through the history so a virtualized timeline mounts each row on the way to the target.
async function scanHistory(scroller: HTMLElement, hosts: HTMLElement[], prompt: Prompt) {
  const step = Math.max(140, (isDocumentScroller(scroller) ? window.innerHeight : scroller.clientHeight) * 0.6)
  let stalls = 0
  for (let i = 0; i < 240; i++) {
    const before = hosts.map((host) => ({ top: hostTop(host), height: host.scrollHeight, max: hostMax(host) }))
    const atEnd = before.every((state) => state.top >= state.max - 4)
    if (!atEnd) {
      for (const host of hosts) {
        if (hostTop(host) < hostMax(host) - 4) setHostTop(host, hostTop(host) + step)
      }
    }
    await delay(atEnd ? 300 : 150)
    if (quickFind(prompt.id) && (await pinPrompt(scroller, prompt, hosts))) return true

    const moved = hosts.some((host, index) => Math.abs(hostTop(host) - before[index].top) > 2)
    const grew = hosts.some((host, index) => host.scrollHeight > before[index].height + 2)
    if (!moved && !grew) {
      stalls += 1
      if (stalls >= 3) return false
      // Let lazy history loaders know we are still moving.
      nudgeWheel(hosts[hosts.length - 1] ?? hosts[0], 320)
      await delay(220)
    } else {
      stalls = 0
    }
  }
  return false
}

async function pageOlderHistory(
  scroller: HTMLElement,
  hosts: HTMLElement[],
  prompt: Prompt,
  host: HTMLElement,
) {
  releaseStick(host)
  await delay(80)
  for (let i = 0; i < 60; i++) {
    if (quickFind(prompt.id) && (await pinPrompt(scroller, prompt, hosts))) return true
    nudgeWheel(host, -Math.max(280, host.clientHeight * 0.8))
    setHostTop(host, Math.max(0, hostTop(host) - host.clientHeight * 0.8))
    await delay(240)
    if (hostTop(host) <= 1) {
      await delay(360)
      if (quickFind(prompt.id) && (await pinPrompt(scroller, prompt, hosts))) return true
      if (i > 10) break
    }
  }
  return false
}

async function revealPrompt(scroller: HTMLElement, prompt: Prompt, index: number, count: number) {
  const hosts = scrollHosts(scroller)
  const restoreSmooth = freezeSmooth(hosts)
  // Rows use `content-visibility`, so heights settle right after a jump. Keep the target pinned briefly.
  const settle = async () => {
    await delay(180)
    await pinPrompt(scroller, prompt, hosts)
    return true
  }
  try {
    if (await pinPrompt(scroller, prompt, hosts)) return await settle()
    if (!hosts.length) return false
    releaseStick(scroller)

    // Older prompts sit above the currently mounted window. Wheel-up pages history in; walking
    // forward would only move toward the live end.
    const host = hosts[hosts.length - 1] ?? hosts[0]
    if (index === 0 || count < 2) {
      return (await pageOlderHistory(scroller, hosts, prompt, host)) ? await settle() : false
    }

    const ratio = index / (count - 1)
    for (const item of hosts) setHostTop(item, hostMax(item) * ratio)
    await delay(240)
    if (await pinPrompt(scroller, prompt, hosts)) return await settle()
    if (await pageOlderHistory(scroller, hosts, prompt, host)) return await settle()
    return (await scanHistory(scroller, hosts, prompt)) ? await settle() : false
  } finally {
    restoreSmooth()
  }
}

// The row that carries the prompt. The timeline renders `id="message-<id>"` for mounted messages,
// which is also what the app's own seek uses.
function anchorElement(id: string) {
  const direct = document.getElementById(`message-${id}`)
  if (direct instanceof HTMLElement) return direct
  const escaped = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(id) : id
  const byData = document.querySelector<HTMLElement>(`[data-message-id="${escaped}"]`)
  if (byData) return byData
  return document.querySelector<HTMLElement>(`[data-timeline-key*="${escaped}"]`) ?? undefined
}

function promptOnScreen(id: string, scroller: HTMLElement) {
  const node = anchorElement(id)
  if (!node) return false
  const rect = node.getBoundingClientRect()
  if (rect.height < 1) return false
  const box = viewportBox(scroller)
  return rect.bottom > box.top + 8 && rect.top < box.bottom - 24
}

function sessionRoutePath(context?: { router?: { path?: () => string } }) {
  const routed = context?.router?.path?.()
  if (typeof routed === "string" && routed.includes("/session/")) return routed.replace(/#.*$/, "")
  const fromWindow = `${window.location.pathname}${window.location.search}`
  if (fromWindow.includes("/session/")) return fromWindow
  return typeof routed === "string" && routed.startsWith("/") ? routed.replace(/#.*$/, "") : fromWindow
}

// Desktop uses MemoryRouter: window.location / popstate never reach the timeline cursor. The app's
// own jump does `navigate(path + "#message-<id>")`. Clicking an in-document <a> is how the router
// exposes that from outside its Solid tree (setupNativeEvents on document).
function clickAppRoute(href: string) {
  const anchor = document.createElement("a")
  anchor.setAttribute("href", href)
  anchor.setAttribute("replace", "")
  anchor.setAttribute("link", "")
  anchor.setAttribute("noscroll", "")
  anchor.tabIndex = -1
  anchor.style.cssText = "position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0"
  document.body.appendChild(anchor)
  anchor.dispatchEvent(
    new MouseEvent("click", { bubbles: true, cancelable: true, composed: true, view: window, button: 0 }),
  )
  anchor.remove()
}

function writeWindowHash(pathWithHash: string) {
  // Only the web UI (path integration) keeps the session in window.location. Desktop's window URL is
  // `oc://renderer/...`; writing a memory path there would unload the page.
  if (!window.location.pathname.includes("/session/")) return
  try {
    window.history.replaceState(window.history.state, "", pathWithHash)
    window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }))
  } catch {
    const index = pathWithHash.indexOf("#")
    window.location.hash = index >= 0 ? pathWithHash.slice(index) : ""
  }
}

function seekMessage(id: string, context?: { router?: { path?: () => string } }, retrigger = false) {
  const path = sessionRoutePath(context)
  if (!path) return
  const target = `${path}#message-${id}`
  if (retrigger) clickAppRoute(path)
  clickAppRoute(target)
  writeWindowHash(target)
}

// The timeline cursor pages history, mounts the virtual row and scrolls it below the sticky header
// when the route hash is `#message-<id>`. Drive that through the app router, not window.location.
async function revealViaRoute(
  scroller: HTMLElement,
  id: string,
  context?: { router?: { path?: () => string } },
) {
  seekMessage(id, context, false)
  for (let attempt = 0; attempt < 80; attempt++) {
    await delay(100)
    if (promptOnScreen(id, scroller)) return true
    // The cursor consumes the hash even when it cannot resolve it yet: on a long session the first
    // seek only starts paging older turns. Re-arm after it has been consumed.
    if ((attempt + 1) % 7 === 0) seekMessage(id, context, true)
  }
  return false
}

async function loadUserPrompts(session: any, signal?: AbortSignal) {
  const lists: unknown[][] = []
  const client = session?.server?.client
  if (client?.message?.list) {
    try {
      let cursor: string | undefined
      for (let page = 0; page < 16; page++) {
        const response = await client.message.list(
          { sessionID: session.id, order: "asc", limit: 200, cursor },
          { signal },
        )
        const items = unwrapList(response).filter(isUserMessage)
        lists.push(items)
        const next = nextCursor(response)
        if (!next || next === cursor || items.length === 0) break
        cursor = next
      }
    } catch {
      /* fall back to the local cache and the rendered timeline */
    }
  }
  try {
    const data = session?.server?.data
    await data?.session?.message?.sync?.(session.id)
    const local = data?.session?.message?.list?.(session.id)
    if (Array.isArray(local)) lists.push(local.filter(isUserMessage))
  } catch {
    /* local cache is optional */
  }
  const scraped = Array.from(document.querySelectorAll("[data-timeline-key], [data-message-id]")).map((node) => ({
    id: messageIDOf(node),
    text: ((node as HTMLElement).innerText || "").trim(),
    type: "user",
  }))
  const known = new Set(mergePrompts(lists).map((item) => item.id))
  if (known.size) lists.push(scraped.filter((item) => item.id && known.has(item.id)))
  else lists.push(scraped)
  return mergePrompts(lists)
}

const Prefs = Schema.Struct({
  enabled: Schema.Boolean,
  left: Schema.Boolean,
  right: Schema.Boolean,
})

const definition = Plugin.define({
  stores: {
    prefs: Store.global(Prefs, { enabled: true, left: true, right: false }),
  },
  i18n: {
    en: {
      title: "Prompt navigator",
      description: "Jump between user prompts with Codex-style rails on the conversation.",
      "settings.section": "Rails",
      "settings.enabled": "Show prompt rails",
      "settings.enabled.description": "Overlay clickable dots on the conversation so you can jump to earlier prompts.",
      "settings.left": "Left rail",
      "settings.right": "Right rail",
      "command.toggle": "Toggle prompt rails",
      "command.prev": "Previous user prompt",
      "command.next": "Next user prompt",
      "command.last": "Jump to last user prompt",
      "command.jump": "Jump to prompt…",
      "jump.title": "User prompts",
      "jump.empty": "No user prompts in this session yet.",
      "tip.label": "Prompt {{n}}",
    },
    zh: {
      title: "提示词导航",
      description: "在对话两侧用点/滑块跳转到历史用户提示词。",
      "settings.section": "轨道",
      "settings.enabled": "显示提示词轨道",
      "settings.enabled.description": "在对话两侧叠放可点击的小点，用来跳回更早的提示词。",
      "settings.left": "左侧轨道",
      "settings.right": "右侧轨道",
      "command.toggle": "开关提示词轨道",
      "command.prev": "上一条用户提示词",
      "command.next": "下一条用户提示词",
      "command.last": "跳到最近一条用户提示词",
      "command.jump": "跳转到提示词…",
      "jump.title": "用户提示词",
      "jump.empty": "当前会话还没有用户提示词。",
      "tip.label": "提示词 {{n}}",
    },
  },
})

function Settings(props: { context: any }) {
  const ui = props.context.ui
  const prefs = () => props.context.stores.prefs.value
  const set = (patch: { enabled?: boolean; left?: boolean; right?: boolean }) => {
    props.context.stores.prefs.update((draft: { enabled: boolean; left: boolean; right: boolean }) => {
      if (patch.enabled !== undefined) draft.enabled = patch.enabled
      if (patch.left !== undefined) draft.left = patch.left
      if (patch.right !== undefined) draft.right = patch.right
    })
  }
  return (
    <ui.SettingsLayout title={props.context.t("title")} description={props.context.t("description")}>
      <ui.SettingsSection title={props.context.t("settings.section")}>
        <ui.SettingsRow
          id="enabled"
          title={props.context.t("settings.enabled")}
          description={props.context.t("settings.enabled.description")}
        >
          <ui.Switch
            label={props.context.t("settings.enabled")}
            hideLabel
            checked={prefs().enabled}
            onChange={(checked: boolean) => set({ enabled: checked })}
          />
        </ui.SettingsRow>
        <ui.SettingsRow id="left" title={props.context.t("settings.left")}>
          <ui.Switch
            label={props.context.t("settings.left")}
            hideLabel
            checked={prefs().left}
            onChange={(checked: boolean) => set({ left: checked })}
          />
        </ui.SettingsRow>
        <ui.SettingsRow id="right" title={props.context.t("settings.right")}>
          <ui.Switch
            label={props.context.t("settings.right")}
            hideLabel
            checked={prefs().right}
            onChange={(checked: boolean) => set({ right: checked })}
          />
        </ui.SettingsRow>
      </ui.SettingsSection>
    </ui.SettingsLayout>
  )
}

function JumpList(props: { context: any; prompts: Prompt[]; active?: string; onPick: (id: string) => void }) {
  return (
    <div class="ocpn-jump">
      <Show when={props.prompts.length > 0} fallback={<div>{props.context.t("jump.empty")}</div>}>
        <For each={props.prompts}>
          {(prompt, index) => (
            <button
              type="button"
              data-active={prompt.id === props.active || undefined}
              onClick={() => props.onPick(prompt.id)}
            >
              <small>{props.context.t("tip.label", { n: index() + 1 })}</small>
              {truncate(prompt.text || extractPromptText(prompt), 140) || "…"}
            </button>
          )}
        </For>
      </Show>
    </div>
  )
}

function Rails(props: {
  context: any
  prompts: Prompt[]
  active?: string
  rect: Rect
  left: boolean
  right: boolean
  onJump: (id: string) => void
}) {
  const [hover, setHover] = createSignal<number>()
  const [dragging, setDragging] = createSignal(false)
  const [tip, setTip] = createSignal<{ x: number; y: number; index: number }>()
  const count = () => props.prompts.length
  const activeIndex = createMemo(() => props.prompts.findIndex((prompt) => prompt.id === props.active))
  const thumbY = createMemo(() => yForIndex(Math.max(0, activeIndex()), count(), props.rect.top + 10, props.rect.height - 20))

  const pick = (event: PointerEvent) => {
    const index = indexFromPointer(event.clientY, props.rect.top + 10, props.rect.height - 20, count())
    const prompt = props.prompts[index]
    if (prompt) props.onJump(prompt.id)
    return index
  }

  const onDown = (event: PointerEvent) => {
    event.preventDefault()
    event.stopPropagation()
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
    setDragging(true)
    const index = pick(event)
    setTip({ x: event.clientX, y: event.clientY, index })
  }
  const onMove = (event: PointerEvent) => {
    if (!dragging()) return
    const index = pick(event)
    setTip({ x: event.clientX, y: event.clientY, index })
  }
  const onUp = () => {
    setDragging(false)
    if (hover() === undefined) setTip(undefined)
  }

  const sides = () => {
    const items: Array<"left" | "right"> = []
    if (props.left) items.push("left")
    if (props.right) items.push("right")
    return items
  }

  return (
    <div class="ocpn-host">
      <For each={sides()}>
        {(side) => (
          <div
            class={`ocpn-rail${dragging() ? " is-dragging" : ""}`}
            data-side={side}
            style={{
              top: `${props.rect.top}px`,
              height: `${props.rect.height}px`,
              left: side === "left" ? `${props.rect.left + 6}px` : `${props.rect.right - 28}px`,
            }}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
          >
            <div class="ocpn-track" />
            <Show when={activeIndex() >= 0}>
              <div class="ocpn-thumb" style={{ top: `${thumbY() - props.rect.top}px` }} />
            </Show>
            <For each={props.prompts}>
              {(prompt, index) => {
                const top = () =>
                  yForIndex(index(), count(), 10, props.rect.height - 20)
                return (
                  <a
                    class="ocpn-dot"
                    href={`${sessionRoutePath(props.context)}#message-${prompt.id}`}
                    replace
                    link
                    noscroll
                    data-active={prompt.id === props.active || undefined}
                    aria-label={props.context.t("tip.label", { n: index() + 1 })}
                    style={{ top: `${top()}px` }}
                    onPointerDown={(event) => {
                      event.stopPropagation()
                    }}
                    onPointerEnter={(event) => {
                      event.stopPropagation()
                      setHover(index())
                      setTip({ x: event.clientX, y: event.clientY, index: index() })
                    }}
                    onPointerLeave={() => {
                      setHover(undefined)
                      if (!dragging()) setTip(undefined)
                    }}
                    onClick={(event) => {
                      // Do not preventDefault/stopPropagation: Desktop MemoryRouter navigates from this click.
                      props.onJump(prompt.id)
                    }}
                  >
                    <i />
                  </a>
                )
              }}
            </For>
          </div>
        )}
      </For>
      <Show when={tip()}>
        {(current) => {
          const prompt = () => props.prompts[current().index]
          const left = () => {
            const preferRight = current().x < window.innerWidth / 2
            return preferRight ? Math.min(window.innerWidth - 300, current().x + 16) : Math.max(12, current().x - 296)
          }
          return (
            <div class="ocpn-tip" style={{ top: `${Math.max(12, current().y - 12)}px`, left: `${left()}px` }}>
              <b>{props.context.t("tip.label", { n: current().index + 1 })}</b>
              {truncate(prompt()?.text, 220) || "…"}
            </div>
          )
        }}
      </Show>
    </div>
  )
}

function Dock(props: { context: any; nav: NavApi }) {
  const [rect, setRect] = createSignal<Rect>()
  let scroller: HTMLElement | undefined
  let jumping = false

  const prefs = () => props.context.stores.prefs.value
  const session = () => props.context.sessions.current()
  const prompts = () => props.nav.prompts()
  const rtl = () => props.context.locale.direction() === "rtl"
  const showLeft = () => (rtl() ? prefs().right : prefs().left)
  const showRight = () => (rtl() ? prefs().left : prefs().right)
  const visible = createMemo(() =>
    shouldShowRail(prompts().length, MIN_PROMPTS, prefs().enabled, props.context.layout.narrow()),
  )

  const refreshActive = () => {
    if (!scroller) return
    const line = scroller.getBoundingClientRect().top + 100
    props.nav.setActive(pickActiveIdAtLine(prompts(), visibleMessageRects(scroller), line))
  }

  const measure = () => {
    scroller = findScroller()
    setRect(scroller ? visibleRect(scroller) : undefined)
    refreshActive()
  }

  const load = async () => {
    const current = session()
    if (!current?.id) {
      props.nav.setPrompts([])
      return
    }
    try {
      const next = await loadUserPrompts(current)
      const prev = prompts()
      const same =
        next.length === prev.length &&
        next.every((item, index) => item.id === prev[index]?.id && item.text === prev[index]?.text)
      if (!same) props.nav.setPrompts(next)
    } catch {
      /* keep last list */
    }
    measure()
  }

  let jumpToken = 0
  const jump = (id: string) => {
    const node = findScroller()
    if (!node) return
    scroller = node
    const list = prompts()
    const index = list.findIndex((item) => item.id === id)
    const prompt = list[index] ?? { id, text: "" }
    const token = ++jumpToken
    jumping = true
    props.nav.setActive(id)
    void revealViaRoute(node, id, props.context)
      .then(async (landed) => {
        if (landed || token !== jumpToken) return
        // The route could not reach the prompt (for example a hash the app refuses to write).
        await revealPrompt(node, prompt, Math.max(0, index), list.length)
      })
      .finally(() => {
        if (token !== jumpToken) return
        window.setTimeout(() => {
          if (token !== jumpToken) return
          jumping = false
          measure()
        }, 320)
      })
  }

  const step = (delta: number) => {
    const list = prompts()
    if (!list.length) return false
    const index = nextIndex(list, props.nav.active(), delta)
    const target = list[index]
    if (!target) return false
    jump(target.id)
    return true
  }
  props.nav.jump = jump
  props.nav.step = step
  props.nav.refresh = () => {
    void load()
    measure()
  }

  onMount(() => {
    const onScroll = () => {
      if (!jumping) refreshActive()
      measure()
    }
    window.addEventListener("scroll", onScroll, true)
    window.addEventListener("resize", measure)
    const observer = new MutationObserver((records) => {
      const ours = (node: Node) =>
        node instanceof Element && (node.classList.contains("ocpn-host") || node.closest(".ocpn-host, .ocpn-tip"))
      if (records.every((record) => [...record.addedNodes, ...record.removedNodes].every(ours))) return
      measure()
    })
    observer.observe(document.body, { childList: true, subtree: true })
    const timer = window.setInterval(() => void load(), 3000)
    void load()
    onCleanup(() => {
      window.removeEventListener("scroll", onScroll, true)
      window.removeEventListener("resize", measure)
      observer.disconnect()
      window.clearInterval(timer)
    })
  })

  const shown = createMemo(() => {
    if (!(visible() && (showLeft() || showRight()))) return undefined
    const full = rect()
    return full ? compactRect(full, prompts().length) : undefined
  })
  return (
    <Show when={shown()}>
      {(box) => (
        <Portal>
          <Rails
            context={props.context}
            prompts={prompts()}
            active={props.nav.active()}
            rect={box()}
            left={showLeft()}
            right={showRight()}
            onJump={jump}
          />
        </Portal>
      )}
    </Show>
  )
}

export default Plugin.define({
  ...definition,
  setup(ctx) {
    const [prompts, setPrompts] = createSignal<Prompt[]>([])
    const [active, setActive] = createSignal<string>()
    const nav: NavApi = {
      prompts,
      setPrompts,
      active,
      setActive,
      jump: () => {},
      step: () => false,
      refresh: () => {},
    }

    createKeyed(
      () => ctx.sessions.current()?.id,
      () => {
        setPrompts([])
        setActive(undefined)
        nav.refresh()
      },
      {
        otherwise: () => {
          setPrompts([])
          setActive(undefined)
        },
      },
    )

    ctx.add(Style, CSS)
    if (ctx.stores.prefs.value.right) {
      ctx.stores.prefs.update((draft) => {
        draft.right = false
      })
    }
    ctx.add(Slot, {
      at: "window.bottom",
      order: 20,
      render: () => <Dock context={ctx} nav={nav} />,
    })
    ctx.add(SettingsPage, {
      id: "prompt-nav",
      get title() {
        return ctx.t("title")
      },
      get entries() {
        return [
          { id: "enabled", title: ctx.t("settings.enabled"), keywords: "prompt rail navigator dots" },
          { id: "left", title: ctx.t("settings.left") },
          { id: "right", title: ctx.t("settings.right") },
        ]
      },
      render: () => <Settings context={ctx} />,
    })
    ctx.add(Command, (): CommandItem => ({
      id: "toggle",
      title: ctx.t("command.toggle"),
      group: ctx.t("title"),
      section: "navigation",
      bind: "mod+alt+.",
      run: () => {
        ctx.stores.prefs.update((draft) => {
          draft.enabled = !draft.enabled
        })
      },
    }))
    ctx.add(Command, (): CommandItem => ({
      id: "prev",
      title: ctx.t("command.prev"),
      group: ctx.t("title"),
      section: "navigation",
      bind: "mod+alt+[",
      enabled: prompts().length > 0,
      run: () => (nav.step(-1) ? undefined : false),
    }))
    ctx.add(Command, (): CommandItem => ({
      id: "next",
      title: ctx.t("command.next"),
      group: ctx.t("title"),
      section: "navigation",
      bind: "mod+alt+]",
      enabled: prompts().length > 0,
      run: () => (nav.step(1) ? undefined : false),
    }))
    ctx.add(Command, (): CommandItem => ({
      id: "last",
      title: ctx.t("command.last"),
      group: ctx.t("title"),
      section: "navigation",
      bind: "mod+alt+end",
      enabled: prompts().length > 0,
      run: () => {
        const last = prompts().at(-1)
        if (!last) return false
        nav.jump(last.id)
      },
    }))
    ctx.add(Command, (): CommandItem => ({
      id: "jump",
      title: ctx.t("command.jump"),
      group: ctx.t("title"),
      section: "navigation",
      slash: { name: "prompts" },
      enabled: !!ctx.sessions.current(),
      run: () => {
        const ui = ctx.ui
        ctx.dialogs.open((dialog) => (
          <ui.Dialog title={ctx.t("jump.title")} size="normal">
            <JumpList
              context={ctx}
              prompts={prompts()}
              active={active()}
              onPick={(id) => {
                nav.jump(id)
                dialog.close()
              }}
            />
          </ui.Dialog>
        ))
      },
    }))
  },
})
