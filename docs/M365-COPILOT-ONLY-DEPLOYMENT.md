# M365-Copilot-only deployment — definitive guide

> **Audience:** customer-facing engineers, ISV solution architects, and tenant admins who need a Copilot Studio agent (or any DA) to **appear only in Microsoft 365 Copilot** and **never in Microsoft Teams or any other surface**.
>
> **Why this doc exists:** the unified app management surface in Teams Admin Center reuses the word "Teams" everywhere even when the underlying app has nothing to do with Teams. Customers see "Teams app" and assume the agent will appear in Teams. **It will not, if the manifest is right.** This doc explains *exactly* why, with the schema citations, a foolproof template, and a verification protocol.

## TL;DR

A Microsoft 365 app package contains a **single `manifest.json`** that declares zero or more *capability blocks*. The set of declared blocks determines exactly which Microsoft 365 surfaces the app appears in:

| Block declared in `manifest.json` | App appears in |
|---|---|
| `bots` | Microsoft Teams chat / channels |
| `staticTabs` (with non-Copilot context) | Microsoft Teams personal tab, Outlook |
| `composeExtensions` | Microsoft Teams message extensions, Outlook |
| `configurableTabs` | Microsoft Teams team / channel tabs |
| `meetingExtensionDefinition` | Microsoft Teams meetings |
| `extensions` (Office add-ins) | Word / Excel / PowerPoint / Outlook |
| **`copilotAgents.declarativeAgents`** | **Microsoft 365 Copilot only** |
| **`copilotExtensions.plugins`** (legacy) | Microsoft 365 Copilot only |

> A package that **only** declares `copilotAgents.declarativeAgents` (and no other blocks above) **cannot appear in Teams**. Period. The app is invisible in Teams chat, channels, message extensions, and meetings. Teams Admin Center *manages* it — it does not *surface* it.

This is the configuration we ship in MCSMCPapps and the configuration any customer should use when their requirement is "M365 Copilot only".

## The technical reason — why "publishing in Teams Admin Center" doesn't put it in Teams

Microsoft 365 has a **unified app catalog** with multiple consumer surfaces. Teams Admin Center is the *administration UI* for that catalog, not the *runtime host* for everything in it. The catalog stores app packages; surfaces query the catalog for apps that declare the capability they support.

```text
                          ┌────────────────────────────┐
                          │ Microsoft 365 App Catalog  │
                          │ (Teams Admin Center is its │
                          │  administration UI)        │
                          └─────────────┬──────────────┘
                                        │
                ┌───────────────────────┼─────────────────────────┐
                │                       │                         │
                ▼                       ▼                         ▼
   ┌───────────────────┐   ┌─────────────────────┐   ┌───────────────────────────┐
   │ Microsoft Teams   │   │ Microsoft 365       │   │ Outlook / Office Add-ins  │
   │                   │   │ Copilot             │   │                           │
   │ Asks catalog:     │   │ Asks catalog:       │   │ Asks catalog:             │
   │ "give me apps     │   │ "give me apps with  │   │ "give me apps with        │
   │  with bots,       │   │  copilotAgents."    │   │  Office extensions or     │
   │  staticTabs,      │   │  declarativeAgents" │   │  Outlook composeExtensions│
   │  composeExt., …"  │   │                     │   │                           │
   └───────────────────┘   └─────────────────────┘   └───────────────────────────┘
```

If your manifest has only `copilotAgents.declarativeAgents`, **only the M365 Copilot lane returns it**. Teams' catalog query never matches. The app exists in the catalog (admin can see it, govern it, audit it) but Teams never displays it because the surface-specific query returns nothing.

## Permutations — exact behavior of each combination

The manifest schema (`https://developer.microsoft.com/json-schemas/teams/v1.22/MicrosoftTeams.schema.json`) allows multiple capability blocks in one manifest. Here is what each combination produces.

| `bots` | `staticTabs` / `configurableTabs` | `composeExtensions` | `extensions` | `copilotAgents.declarativeAgents` | Result |
|:---:|:---:|:---:|:---:|:---:|---|
| ❌ | ❌ | ❌ | ❌ | ✅ | ✅ **M365 Copilot only.** Invisible in Teams, Outlook, Office.<br/>**This is the foolproof config.** |
| ❌ | ❌ | ❌ | ❌ | ❌ | App package is valid but useless. Catalog stores nothing. |
| ✅ | ❌ | ❌ | ❌ | ✅ | App appears in Teams chat AND M365 Copilot. ❌ Not what we want. |
| ❌ | ✅ (with Copilot context) | ❌ | ❌ | ✅ | Special case: a Copilot-context tab is a Copilot surface artifact, not a Teams tab. Verify with [Copilot tab docs](https://learn.microsoft.com/microsoft-365/copilot/extensibility/) before using. Generally avoid for "Copilot-only" requirement. |
| ❌ | ✅ (no `scopes`/no Copilot context) | ❌ | ❌ | ✅ | Tab appears in Teams personal app + Outlook. ❌ Not Copilot-only. |
| ❌ | ❌ | ✅ | ❌ | ✅ | Message extension appears in Teams + Outlook. ❌ |
| ❌ | ❌ | ❌ | ✅ | ✅ | Office add-in appears in Word/Excel/etc. ❌ |
| ✅ | ✅ | ✅ | ✅ | ✅ | App is everywhere. Maximum surface. |
| ✅ | ✅ | ✅ | ✅ | ❌ | Classic Teams app, no Copilot agent. |

**Foolproof rule:** if the customer requirement is "M365 Copilot only", the manifest **MUST contain only** `copilotAgents.declarativeAgents` from the table above and **NO other capability blocks**.

## The foolproof template

Save this as your customer's `appPackage/manifest.json`. Replace placeholders. Do **not** add any other capability blocks unless you intend to expand surfaces.

```json
{
  "$schema": "https://developer.microsoft.com/json-schemas/teams/v1.22/MicrosoftTeams.schema.json",
  "manifestVersion": "1.22",
  "version": "1.0.0",
  "id": "${{TEAMS_APP_ID}}",
  "developer": {
    "name": "Acme Corp",
    "websiteUrl": "https://acme.example.com",
    "privacyUrl": "https://acme.example.com/privacy",
    "termsOfUseUrl": "https://acme.example.com/terms"
  },
  "icons": {
    "color": "color.png",
    "outline": "outline.png"
  },
  "name": {
    "short": "Acme Analyst",
    "full": "Acme Analyst (Eurozone briefings)"
  },
  "description": {
    "short": "Eurozone economic briefings.",
    "full": "Embedded Copilot Studio agent for Eurozone economic analysis."
  },
  "accentColor": "#003399",

  "copilotAgents": {
    "declarativeAgents": [
      {
        "id": "acmeAnalyst",
        "file": "declarativeAgent.json"
      }
    ]
  },

  "permissions": ["identity"],

  "validDomains": [
    "your-mcp-server.azurewebsites.net",
    "your-swa.azurestaticapps.net"
  ]
}
```

**Anti-checklist** — confirm none of these blocks exist:

- [ ] No `bots`
- [ ] No `staticTabs`
- [ ] No `configurableTabs`
- [ ] No `composeExtensions`
- [ ] No `meetingExtensionDefinition`
- [ ] No `extensions`
- [ ] No `connectors`
- [ ] No `webApplicationInfo` (unless your DA actions specifically need it)

If any of those exist, the app gains additional surfaces. Remove them.

## Foolproof verification protocol

Run this protocol after every publish to confirm "Copilot-only" status. **All 7 checks must pass.**

### Check 1 — Manifest static analysis (~30 sec)

```powershell
# Run from repo root
$manifest = Get-Content declarative-agent/appPackage/manifest.json -Raw | ConvertFrom-Json
$forbidden = @('bots','staticTabs','configurableTabs','composeExtensions',
               'meetingExtensionDefinition','extensions','connectors')
$found = $forbidden | Where-Object { $manifest.PSObject.Properties.Name -contains $_ }
if ($found) {
  Write-Host "FAIL: manifest contains non-Copilot capability block(s): $($found -join ', ')" -ForegroundColor Red
  exit 1
} else {
  Write-Host "PASS: manifest is M365-Copilot-only." -ForegroundColor Green
}
```

✅ Expected: `PASS: manifest is M365-Copilot-only.`

### Check 2 — Toolkit validation passes

Run `teamsApp/validateAppPackage` (the M365 Agents Toolkit does this automatically during Publish). It validates the manifest against the schema and reports invalid combinations. The toolkit does NOT block valid combinations of blocks though, so this check guarantees only **schema correctness**, not **surface scope**. Combine with Check 1.

✅ Expected: 0 errors.

### Check 3 — Microsoft Teams (desktop or web) does NOT show the app

Sign in to Microsoft Teams as a user in the target tenant.

- Open **Apps** in the left rail
- Search for the app's display name
- Search for any unique word from `description.full`
- Open **Built for your org** filter

✅ Expected: zero results in all four searches. If anything shows up, the manifest is leaking.

### Check 4 — Outlook does NOT show the app

Sign in to Outlook on the web.

- Settings (gear) → **Get add-ins** → Admin-managed
- Search for the app

✅ Expected: zero results. If shown, the manifest contains `composeExtensions` or `extensions` or a non-scoped `staticTab`.

### Check 5 — Word / Excel / PowerPoint do NOT show the app

Open Word on the web → **Insert → Office Add-ins** → Admin-managed.

✅ Expected: zero results. If shown, manifest contains `extensions`.

### Check 6 — Microsoft 365 Copilot DOES show the agent

Sign in to <https://m365.cloud.microsoft/chat>.

- Open the agent picker
- Search for the agent's name (or any conversation starter text)

✅ Expected: agent is found. If not found:
- Confirm the publish completed in Teams Admin Center (Pending action → click Publish → status becomes "Published")
- Wait 5–15 min for tenant catalog propagation
- Confirm the user has a Microsoft 365 Copilot license (some agent capabilities require it)

### Check 7 — Teams Admin Center records the app correctly

In Teams Admin Center → **Teams apps** → **Manage apps**:

- Search the app name
- Click into it
- Verify on the **About** tab that no Teams-specific capability is listed (no Bot, no Tabs, no Messaging extensions). The page may show "Categories: Microsoft 365 Copilot" or similar.

✅ Expected: the app's capabilities listed are only Copilot-related. If the card shows a "Bot" badge or "Tabs" badge, the manifest is leaking — go back to Check 1.

## Org-wide rollout — the foolproof admin sequence

After all 7 checks pass, here is how a tenant admin makes the agent available **org-wide in M365 Copilot only**:

### Step 1 — Publish to the tenant catalog

Teams Admin Center → **Teams apps → Manage apps** → search for the agent → ⚠️ "Pending action" → click **Publish** → confirm.

Status changes to **Published**.

### Step 2 — Allow the app at the tenant level

Same admin page → click into the app → **Status** dropdown → **Allowed** (it's likely already Allowed; verify).

### Step 3 — Pin to the Copilot agent picker (recommended)

Microsoft 365 admin center → **Settings → Microsoft 365 Copilot** → **Manage agents** → find the agent → click **Pin for all users**.

This makes the agent appear in every user's Copilot agent sidebar without them needing to install it manually.

(Alternative: leave it un-pinned; users have to discover via the Agent Store. For org-wide adoption, pin it.)

### Step 4 — Optional: scope to a group during pilot

Microsoft 365 admin center → **Settings → Microsoft 365 Copilot** → **Manage agents** → the agent → **Pin for specific users** → select an Entra group.

Use this for a phased rollout. When confident, change to "Pin for all users".

### Step 5 — Communicate to users

Send your users a one-line note:

> "The Acme Analyst agent is now available in Microsoft 365 Copilot. Open <https://m365.cloud.microsoft/chat>, click the agent picker, and pick **Acme Analyst**."

They never need to know the agent exists in any admin portal.

### Step 6 — Confirm rollout took effect

Have a non-admin user in the target group sign into <https://m365.cloud.microsoft/chat>. The agent should appear in their picker (auto-pinned if Step 3 was done).

It will **not** appear in their Teams app, Outlook, Word, Excel, or PowerPoint. Confirm by asking the user to look.

## What can go wrong (and how to catch it before the customer does)

| Symptom | Root cause | Fix |
|---|---|---|
| Agent appears in Teams chat | Manifest leaked a `bots` block | Remove `bots` from `manifest.json`, bump `version`, re-publish |
| Agent appears as a Teams personal tab | Manifest leaked a `staticTabs` block without Copilot context | Remove `staticTabs`, re-publish |
| Agent appears in Outlook compose | Manifest leaked `composeExtensions` | Remove, re-publish |
| Agent does NOT appear in M365 Copilot | Several possible: not published, not licensed, catalog not propagated, user not in scoped group | Run verification Check 6 troubleshooting steps |
| User sees agent but it errors when invoked | App is published but admin policy blocks Copilot agents tenant-wide | Microsoft 365 admin center → Copilot settings → ensure custom agents are allowed |

## Reproducibility — keep this contract under git

To prevent regressions:

1. **Commit a manifest validator script** (Check 1 above) and run it as a CI check on every PR.

```yaml
# .github/workflows/manifest-scope.yml
name: Manifest scope check
on: [push, pull_request]
jobs:
  scope:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: |
          node -e "
          const m = JSON.parse(require('fs').readFileSync('declarative-agent/appPackage/manifest.json', 'utf8'));
          const forbidden = ['bots','staticTabs','configurableTabs','composeExtensions',
                             'meetingExtensionDefinition','extensions','connectors'];
          const leaked = forbidden.filter(k => k in m);
          if (leaked.length) { console.error('FAIL leaked:', leaked); process.exit(1); }
          console.log('PASS Copilot-only');
          "
```

2. **Document the customer commitment** in the repo's README ("This agent is Microsoft 365 Copilot only. The CI manifest-scope check enforces it. Pull requests that introduce non-Copilot capability blocks will be rejected.")

3. **Pin the manifest schema version** so a future manifest version doesn't quietly introduce a default that adds surfaces.

## Summary table — your customer can hand this to their security review

| Question | Answer |
|---|---|
| Does this agent run in Teams? | No. The manifest does not declare any Teams capability blocks; Teams' catalog query returns no match. |
| Can users invoke it from Teams chat? | No. |
| Can users invoke it from a Teams meeting or channel? | No. |
| Can it be added as a Teams personal tab? | No. |
| Can it be installed as an Outlook add-in? | No. |
| Can it be installed as a Word / Excel / PowerPoint add-in? | No. |
| Where can users invoke it? | Microsoft 365 Copilot only — at <https://m365.cloud.microsoft/chat>, via the agent picker. |
| How is this enforced? | Static analysis of `manifest.json` confirms zero non-Copilot capability blocks. The unified app catalog routes apps to surfaces based on declared capabilities; with only `copilotAgents.declarativeAgents`, only the M365 Copilot surface receives the app. CI gate prevents regressions. |
| What if Microsoft introduces new surfaces in the future? | Pin the manifest `manifestVersion`. New surfaces require new manifest blocks; pinning prevents accidental opt-in. Audit before bumping the version. |

## Related docs

- [BUILD-GUIDE.md](BUILD-GUIDE.md) §"Phase 5" — the full build that produced the foolproof manifest in this repo
- [AUTH-ARCHITECTURE.md](AUTH-ARCHITECTURE.md) — auth boundaries (orthogonal to surface scope)
- [FINAL-RECIPE.md](FINAL-RECIPE.md) — the 8-ingredient recipe; this doc adds the "lock down to Copilot-only" guarantee
- The manifest in this repo at [`declarative-agent/appPackage/manifest.json`](../declarative-agent/appPackage/manifest.json) is itself an instance of the foolproof template — copy from there.
