# Prompt Nav Rail for OpenCode

> Repository: `history_prompt_navigator_for_opencode`

Codex / Antigravity-style **prompt navigation rails** for **OpenCode Desktop**.

OpenCode does not ship this. `MessageNav` exists in `session-ui` but is not wired into the desktop session view. An experimental turn navigator landed on `dev` and was later removed. There is no published plugin that restores it, so this one does.

## What you get

On a session with at least one user prompt, a thin rail of dots appears on **both sides** of the conversation:

- Click a dot to jump to that prompt
- Drag along the rail to scrub through prompts
- Hover to preview the original text
- The active prompt stays highlighted while you scroll
- Hidden on narrow windows and on sessions that are still short

## Shortcuts

| Action | Default |
| --- | --- |
| Previous prompt | `Ctrl/Cmd+Alt+[` |
| Next prompt | `Ctrl/Cmd+Alt+]` |
| Last prompt | `Ctrl/Cmd+Alt+End` |
| Toggle rails | `Ctrl/Cmd+Alt+.` |
| Jump list | `/prompts` |

Change them in **Settings → Shortcuts**. Turn a side off in **Settings → Prompt navigator**.

## Install

The plugin is a local directory. Add it to global `opencode.json(c)`:

```jsonc
{
  "plugins": [
    "/absolute/path/to/history_prompt_indicator_for_opencode"
  ]
}
```

Or drop the folder in the discovery path:

```text
# Windows
%USERPROFILE%\.config\opencode\plugins\history_prompt_indicator_for_opencode

# macOS / Linux
~/.config/opencode/plugins/history_prompt_indicator_for_opencode
```

After changing the GUI bundle, **Settings → Extensions → Plugins → Reload**, or fully quit and reopen OpenCode Desktop. The server part reloads with `/reload`.

## Build

```bash
npm install
npm test
npm run build
```

`npm run build` emits `dist/gui-experimental.cjs`, the bundle Desktop loads. It is committed, so a clone works without building.

## Files

| File | Purpose |
| --- | --- |
| `nav.mjs` | Prompt list merge, rail math, active-prompt picking |
| `nav.test.mjs` | Unit tests for that math |
| `gui.tsx` | Desktop rails, hover preview, commands, settings |
| `index.ts` | Server part (`id`) |
| `vite.config.ts` | GUI bundle build |

MIT.
