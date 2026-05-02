# IDEAS — Output language preference & translation pipeline

> **Status:** filed for later. Not in scope for Phase 7 / 5 / current demo.
>
> Captured: May 2026.

## Goal

Let the user pick a preferred output language at the start of the conversation, then have the agent honor that preference for **every outgoing message** — even when downstream child agents, knowledge sources, or tools return content in a different language.

This makes the agent feel:
- **Multilingual but consistent** — user sees one language regardless of what data sources or sub-agents reply in.
- **Locale-aware without hardcoding** — adapts per session, not at build time.
- **Polite about input** — the user can still type in *any* language; only output is normalized.

## Architecture sketch

```text
                       ┌────────────────────────┐
                       │ User picks language    │
                       │ (dropdown at session   │
                       │  start, surfaced by    │
                       │  the WebChat shell or  │
                       │  by a topic)           │
                       └──────────┬─────────────┘
                                  │ event: 'languagePreferenceSet'
                                  │   value: { code: 'es-ES', label: 'Español' }
                                  ▼
                       ┌────────────────────────┐
                       │ CS topic stores it as  │
                       │ a global variable      │
                       │ Global.PreferredLang   │
                       └──────────┬─────────────┘
                                  │
              ┌───────────────────┼─────────────────────────┐
              ▼                   ▼                         ▼
   ┌────────────────────┐ ┌────────────────────┐ ┌────────────────────────┐
   │ Top-level          │ │ Child agents +     │ │ user.language          │
   │ agent instructions │ │ connected agents   │ │ system parameter       │
   │ get a hint:        │ │ get the same hint  │ │ (set if supported by   │
   │ "User prefers      │ │ via a fact / shared│ │  the channel; CS Wave-2│
   │  Spanish (es-ES);  │ │ topic variable.    │ │  exposes this for some │
   │  understand any    │ │                    │ │  channels)             │
   │  language but lean │ │                    │ │                        │
   │  Spanish in        │ │                    │ │                        │
   │  interpretation."  │ │                    │ │                        │
   └────────┬───────────┘ └─────────┬──────────┘ └───────────┬────────────┘
            │                       │                        │
            └───────────────────────┴────────────────────────┘
                                  │
                                  ▼
                    ┌──────────────────────────────────┐
                    │ Output interception trigger      │
                    │ (system topic, fires before each │
                    │  outgoing message reaches the    │
                    │  channel)                        │
                    │                                  │
                    │  if (msg.language !== preferred) │
                    │    msg.text = translate(         │
                    │      msg.text, preferred,        │
                    │      preserveFormatting=true)    │
                    │  else                            │
                    │    pass-through                  │
                    └──────────────┬───────────────────┘
                                  │
                                  ▼
                            User sees output
```

## Why an interception trigger and not "just tell the LLM"

- **Determinism.** A system-level translation trigger applies even when topic logic forgets, when a child agent ignores instructions, or when a knowledge-source citation comes back in the source's native language.
- **Format preservation.** Markdown headings, code blocks, table cells, citations, link targets, and Adaptive Card body should NOT be translated as a flat string. The trigger walks the message structure and translates only user-facing text nodes.
- **Cost control.** Skip the translation call when the message is already in the preferred language (LLM detects, or use `franc` / language-id models).

## What changes where

| Surface | Change |
|---|---|
| **WebChat (this repo)** | Add a `<select>` at session start (or in the header) with the supported language list. On change, send an outbound `event` activity `name === 'languagePreferenceSet'` carrying `{ code, label }`. |
| **CS top-level instructions** | Insert a substitution placeholder: `"User prefers {{Global.PreferredLang}}; you may receive any language but lean toward {{Global.PreferredLang}} in interpretation. The output translator will normalize your final reply, so write naturally — do not pre-translate."` |
| **CS global variable** | `Global.PreferredLang` (string, BCP-47 like `es-ES`). Default = `Global.UserLocale` if known, else `en-US`. |
| **CS child / connected agents** | Same substitution; pass `PreferredLang` as a fact when invoking. |
| **`user.language` system parameter** | Set on session start so channel-aware components (e.g. Adaptive Cards' date/number formatting) follow suit. |
| **Output interception trigger (new system topic)** | Fires on every outbound message activity. Detects message language (skip if already match). Calls a translator (Power Platform translator connector or Azure Translator) on text-bearing nodes only. Re-emits the activity. |
| **Translation cache** | Optional. Same `(source, target, hash)` → cache to avoid translating identical content twice in one session. |

## Subtle requirements

- **Adaptive Cards bodies** are JSON. Walk the tree, translate only `TextBlock.text`, `Input.*.placeholder`, `Action.*.title` strings. Leave structural fields and IDs alone.
- **Markdown** must round-trip safely: don't translate code spans, code blocks, link URLs, image alt vs title carefully.
- **Citations / footnotes** should keep their reference markers (`[^1]`, `[1]`) untouched while translating the citation body.
- **Suggested actions** — translate `title` field (button label) but leave `value` (what gets sent back) alone, **unless** the topic specifically expects translated values.
- **User-visible system messages** (e.g. our connection banner) should also respect the preference. Add a tiny i18n table in the WebChat for a few hard-coded strings, fed from `Branding.locale` set by the maker as a default.
- **Initial language detection** — for the first turn before the user picks, fall back to `navigator.language` from the WebChat's `userContext` event, then ask "Switch to X?" if confidence is low.

## Maker affordances

| Maker setting | Purpose |
|---|---|
| `VITE_DEFAULT_LANGUAGE` | Default if user doesn't pick (BCP-47) |
| `VITE_LANGUAGE_OPTIONS` | Comma-separated BCP-47 codes to surface in the dropdown |
| `VITE_LANGUAGE_LABEL_FORMAT` | `native` / `english` / `both` — how the option labels render |
| `VITE_LANGUAGE_PICKER_MODE` | `header` (always-visible dropdown) / `topic` (user-selected via a CS topic) / `auto` (skip the picker, use `navigator.language`) |

## Implementation order (when we get to this)

1. **CS** — define `Global.PreferredLang` + a "Set Language" topic that prompts a card with options.
2. **CS** — define an "Output Translator" trigger / system topic that calls Power Platform Language → Translator on outgoing message activities. Test with a simple reply.
3. **WebChat** — add the dropdown in the header (or reuse the suggested-actions row of the welcome topic). Send `languagePreferenceSet` event.
4. **CS** — top-level + child agent instructions get the substitution.
5. **WebChat** — i18n the small set of system strings ("Connecting…", "Sign in…", typing tooltip).
6. **Tests** — verify formatting fidelity for markdown reports, Adaptive Cards, suggested actions, citations.
7. **Cost guard** — language-detection short-circuit, per-conversation translation cache.

## Stretch ideas

- **Voice-locale awareness.** When the user speaks via the browser STT API, set the recognition locale to `Global.PreferredLang`.
- **Message-level override.** Topic can mark a message as `dontTranslate: true` for technical content / proper nouns.
- **Per-section language.** A markdown section explicitly tagged in another language is preserved (like quoting an English source within a Spanish reply).

## Why this is filed and not built now

Translation introduces an LLM cost dependency, a cache to manage, language-detection edge cases, and significant CS topic surgery. None of that is needed for the demo we're shipping next. But it's a clean pattern and worth designing now while it's fresh; the WebChat already has the event hook to wire it in (`event: 'languagePreferenceSet'` is just a new name on the existing pipe).
