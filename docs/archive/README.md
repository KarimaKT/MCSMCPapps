# Archive

Historical docs preserved for traceability. **Do not link to these from current docs.** They are kept because they were referenced by past commits, blog comments, and external links, and they capture the project's design lineage. The current docs are in the parent `docs/` directory.

| File | What it was | Why archived |
|---|---|---|
| [`ARCHITECTURE.v0.5.md`](ARCHITECTURE.v0.5.md) | The v0.5 architecture doc — "chat-in-chat" widget pattern with BotFramework Web Chat inside the M365 Copilot iframe, MSAL silent SSO in the browser. | The chat-in-chat pattern was abandoned in v0.6 per [ADR 0001](../decisions/0001-chat-in-chat-was-wrong.md). The new architecture is in [`ARCHITECTURE.md`](../ARCHITECTURE.md). |
| [`WIDGET-CUSTOMIZATION.v0.5.md`](WIDGET-CUSTOMIZATION.v0.5.md) | The v0.5 widget customization guide — BotFramework Web Chat `styleOptions` JSON, editing `Widget.tsx` with `<Composer>` + `<BasicWebChat>`. | Same architecture pivot. The current guide is in [`WIDGET-CUSTOMIZATION.md`](../WIDGET-CUSTOMIZATION.md). |
| [`BLOG-DRAFT.2026-04.md`](BLOG-DRAFT.2026-04.md) | An early "better together" blog draft from April 2026, prior to the data-widget pivot. | Superseded by [`BLOG.md`](../BLOG.md) (canonical) and the short v0.7 variant ([`BLOG-v0.7-short.2026-05.md`](BLOG-v0.7-short.2026-05.md)). |
| [`BLOG-v0.7-short.2026-05.md`](BLOG-v0.7-short.2026-05.md) | A condensed v0.7 blog draft. | The longer [`BLOG.md`](../BLOG.md) is the canonical version. Kept as a reference for the short-form pitch if a future shorter blog post is wanted. |
