export function unwrapList(response) {
  if (Array.isArray(response)) return response
  if (Array.isArray(response?.data)) return response.data
  if (Array.isArray(response?.messages)) return response.messages
  return []
}

export function isUserMessage(item) {
  if (!item || typeof item !== "object") return false
  return item.type === "user" || item.role === "user"
}

export function extractPromptText(item) {
  if (!item || typeof item !== "object") return ""
  if (typeof item.text === "string" && item.text.trim()) return item.text
  const summary = item.summary
  if (typeof summary === "string" && summary.trim()) return summary
  if (summary && typeof summary.title === "string" && summary.title.trim()) return summary.title
  if (Array.isArray(item.parts)) {
    return item.parts
      .map((part) => {
        if (typeof part === "string") return part
        if (part && typeof part.text === "string") return part.text
        if (part && part.type === "text" && typeof part.content === "string") return part.content
        return ""
      })
      .filter(Boolean)
      .join("\n")
  }
  if (typeof item.content === "string") return item.content
  return ""
}

export function toPrompt(item) {
  const id = item?.id || item?.messageID
  if (!id) return null
  return { id: String(id), text: extractPromptText(item) }
}

export function mergePrompts(lists) {
  const seen = new Map()
  for (const list of lists) {
    if (!Array.isArray(list)) continue
    for (const item of list) {
      const prompt = toPrompt(item)
      if (!prompt) continue
      const previous = seen.get(prompt.id)
      if (!previous) seen.set(prompt.id, prompt)
      else if (!previous.text && prompt.text) seen.set(prompt.id, prompt)
    }
  }
  return [...seen.values()]
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

export function indexFromPointer(y, top, height, count) {
  if (count <= 1 || height <= 0) return 0
  const t = clamp((y - top) / height, 0, 1)
  return Math.round(t * (count - 1))
}

export function yForIndex(index, count, top, height) {
  if (count <= 1) return top + height / 2
  return top + (clamp(index, 0, count - 1) / (count - 1)) * height
}

export function pickActiveIdAtLine(prompts, visible, lineY) {
  if (!prompts.length) return undefined
  const order = new Map(prompts.map((prompt, index) => [prompt.id, index]))
  const shown = visible.filter((item) => order.has(item.id))
  if (!shown.length) return undefined
  const hit = shown.find((item) => item.top <= lineY && item.bottom >= lineY)
  if (hit) return hit.id
  const above = shown.filter((item) => item.top <= lineY)
  if (above.length) return above[above.length - 1].id
  return [...shown].sort((a, b) => Math.abs(a.top - lineY) - Math.abs(b.top - lineY))[0]?.id
}

export function truncate(text, max = 160) {
  const value = String(text || "")
    .replace(/\s+/g, " ")
    .trim()
  if (value.length <= max) return value
  return `${value.slice(0, Math.max(0, max - 1))}…`
}

export function shouldShowRail(count, minPrompts, enabled, narrow) {
  return Boolean(enabled) && !narrow && count >= minPrompts
}

export function nextIndex(prompts, currentId, delta) {
  if (!prompts.length) return -1
  const at = prompts.findIndex((prompt) => prompt.id === currentId)
  const base = at < 0 ? (delta > 0 ? -1 : prompts.length) : at
  return clamp(base + delta, 0, prompts.length - 1)
}

export function nextCursor(response) {
  const next = response?.cursor?.next
  return typeof next === "string" && next ? next : undefined
}

export function railSpan(count, baseHeight, minGap) {
  const base = Math.max(0, baseHeight)
  const gap = Math.max(0, minGap)
  if (count <= 1) return base
  const gaps = count - 1
  if (base / gaps >= gap) return base
  return gaps * gap
}
