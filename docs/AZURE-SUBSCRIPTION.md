# Azure subscription — getting one for this project

You need an Azure subscription to host the WebChat UI on Azure Static Web Apps (SWA). The Free SKU is **$0/month**, so the only real concern is *which* subscription to put it under.

## Option matrix (pick one)

| Option | Cost | Time to get | Best for | Notes |
|---|---|---|---|---|
| **A. Visual Studio / MSDN benefit** | $150/mo USD credit (Microsoft FTEs) | Instant if you've never activated it | **Recommended for Microsoft employees.** Plenty of headroom for SWA Free + small App Services. | Activate at <https://my.visualstudio.com> → **Benefits** → **Azure**. |
| **B. Azure free trial** | $200 USD credit, 30 days, then pay-as-you-go on free SKUs only | Instant | Anyone with a personal Microsoft account and a credit card. | Card required for identity verification. |
| **C. Pay-as-you-go (PAYG)** | $0 floor + usage | Instant | When you already have a billing account but no sub. | Card required. |
| **D. Existing internal sub** | $0 (or charged to a cost center) | Instant if you know which | If your team already has a shared dev subscription. | Ask your manager / TPM. |
| **E. Microsoft for Startups / partner** | Varies | Days | Not relevant unless you're a startup. | — |

> **Strong recommendation:** Option A (Visual Studio benefit) if you haven't burned it yet. SWA Free is $0 anyway, but the credit covers any incidental App Service / Functions you may add later for the token broker.

## Pre-flight: are you sure you need a new sub?

Run this — it will list any subscriptions you can already see with your work account:

```powershell
# Will install only if missing
if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
  winget install -e --id Microsoft.AzureCLI --accept-package-agreements --accept-source-agreements
  $env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' +
              [System.Environment]::GetEnvironmentVariable('Path','User')
}
az login
az account list --output table
```

If a subscription appears, you don't need to create one. Note its **SubscriptionId** and skip to [BUILD-GUIDE §4](BUILD-GUIDE.md#4-host-on-azure-static-web-apps).

## Walkthrough — Option A (Visual Studio benefit)

> Use this if you're a Microsoft employee and haven't activated your Azure benefit yet.

1. 🪟 Open <https://my.visualstudio.com> and sign in with your work account.
2. Click **Benefits** in the top nav.
3. Find the **Azure** tile → **Activate**.
4. Confirm the offer (`MS-AZR-0063P` — Visual Studio Enterprise Subscribers). It says "monthly credit"; $150/mo for Enterprise, $50/mo for Professional.
5. After activation, you're redirected to <https://portal.azure.com>. A new subscription called **"Visual Studio Enterprise"** (or similar) appears under your tenant.
6. **Verify** in PowerShell:
   ```powershell
   az login
   az account list --output table
   az account set --subscription "Visual Studio Enterprise"  # name as shown
   az account show --query "{name:name,id:id,tenantId:tenantId}"
   ```
7. Copy the **`id`** and **`tenantId`** values into [IDs.md](IDs.md) under the Azure section.

## Walkthrough — Option B (Azure free trial)

> Use this if you don't qualify for the VS benefit.

1. 🪟 Open <https://azure.microsoft.com/free>.
2. Sign in (or create) a Microsoft account. **Use a personal MSA if you want full ownership** of the sub.
3. Verify identity:
   - Phone number
   - Credit/debit card (no charges unless you upgrade)
4. Agree to terms → **Sign up**.
5. After provisioning (≈2 min), portal.azure.com shows a subscription called **"Free Trial"**.
6. Run `az login` and `az account list -o table` to verify.

## What to do after you have a subscription

1. Add the IDs to `docs/IDs.md`:
   ```text
   Subscription ID:        <copied from `az account show`>
   Subscription Tenant ID: <copied from `az account show`>
   ```
2. (Optional but recommended) Set a **billing alert** at $5 so you get an email if anything starts costing money:
   ```powershell
   $sub = az account show --query id -o tsv
   az consumption budget create --budget-name mcsmcpapps-alert --amount 5 --time-grain Monthly --start-date "$(Get-Date -Format yyyy-MM-01)" --category Cost --time-period startDate="$(Get-Date -Format yyyy-MM-01)"
   ```
   (If that command errors out, set it via the portal: **Cost Management** → **Budgets** → **Add**.)
3. Move on to [BUILD-GUIDE §4](BUILD-GUIDE.md#4-host-on-azure-static-web-apps).

## Resource group decisions for this project

| Setting | Value | Why |
|---|---|---|
| Resource group name | `rg-mcsmcpapps` | Simple, scoped to this project. |
| Region | `westus2` | SWA Free SKU available; geographically diverse. Pick `eastus2` if you're east coast. |
| Tags | `project=MCSMCPapps`, `owner=karima`, `cost=experimental` | Useful when you have many subs. |

## What this will actually cost

| Resource | SKU | Monthly cost (est.) |
|---|---|---|
| Static Web App | Free | **$0** |
| GitHub Actions runners (public repo) | Free tier | **$0** |
| Bandwidth (under 100 GB) | Free | **$0** |
| Optional Azure Function (if added for token broker) | Consumption | **<$1** for dev usage |

So worst case, this project costs **single-digit dollars per month** even on PAYG. The VS benefit fully absorbs it.

## Common pitfalls

- **Wrong tenant.** Your *Azure* tenant and your *Copilot Studio / M365* tenant should match for SSO to work cleanly. If your VS benefit creates a sub under a different tenant, you can use it but the app registration needs to live in the same tenant as your CS agent. Talk to me if this happens.
- **Subscription says "Disabled".** Activation takes 1–5 minutes; refresh and try again. If still blocked, check <https://portal.azure.com/#blade/Microsoft_Azure_Billing/SubscriptionsBlade> for the status reason.
- **`az login` opens wrong account.** Use `az login --use-device-code --tenant <tenantId>` to force the right one.
