# Ideas (parking lot)

Ideas captured for future work that aren't in scope for the current build.

| Idea | File |
|---|---|
| Output language preference + translation pipeline | [language-preference-and-translation.md](language-preference-and-translation.md) |

## Reusable Copilot Studio primitives surfaced during this work

| Primitive | Where to find it | Useful for |
|---|---|---|
| **`OnOutgoingMessage` trigger** | [language-preference-and-translation.md § Confirmed primitives](language-preference-and-translation.md#confirmed-primitives--onoutgoingmessage-trigger-works-today) | Selectively rewrite or suppress every outbound message. Use cases: translation, redaction, persona enforcement, audit logging, output signing, content-policy filtering. |

When you start building one of these, move the relevant content into `docs/CAPABILITIES.md` and `docs/BUILD-GUIDE.md` as it lands.
