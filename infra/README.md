# Infra

Bicep templates that provision the Azure resources for this project.

## What gets provisioned

[`main.bicep`](main.bicep) deploys, into a resource group you create:

- **App Service Plan (Linux, B1 Basic)** — `plan-mcsmcpapps-mcp` by default. ~$13/month.
- **App Service (Linux, Node 20-LTS)** — `app-mcsmcpapps-mcp` by default. Hosts the MCP server. Always On enabled. CORS allowlists the M365 Copilot widget host origins.
- **Static Web App (Free SKU)** — `swa-mcsmcpapps` by default. Hosts the standalone WebChat (off-Copilot embedding). Optional for M365 Copilot-only deployments.

Application Insights is **not** provisioned by this template — enable it from the portal post-deploy if you want browser + server telemetry.

## Deploy

```pwsh
az login
az account set --subscription "<your subscription id>"
az group create --name rg-mcsmcpapps --location westus2
az deployment group create `
  --resource-group rg-mcsmcpapps `
  --template-file infra/main.bicep `
  --parameters mcpAgentName="Eurozone Analyst" `
               mcpAgentDescription="AI economic briefings for the Euro area" `
               swaName=swa-mcsmcpapps-yourname `
               mcpAppName=app-mcsmcpapps-mcp-yourname
```

Resource names must be globally unique in their respective namespaces (SWA hostname, App Service hostname). Append a personal suffix to avoid collisions.

The template intentionally does **not** create the Entra app registration — that's a manual step documented in [`docs/QUICK-START.md` § Step 5](../docs/QUICK-START.md).

## Update after first deploy

The Bicep is idempotent. Run the same `az deployment group create` command to apply later changes (new app settings, SKU changes, etc.). For Entra SSO env vars specifically, use `az webapp config appsettings set` instead — it's faster than redeploying the template.

## Region notes

- **SWA** is limited to a small set of regions (`westus2`, `eastus2`, `eastasia`, `westeurope`, `centralus`); `westus2` is the default.
- **App Service B1** quota varies per subscription. The default sets `mcpLocation = location`. If your subscription has B1 quota 0 in your SWA region, override `mcpLocation` to a different region (the original deployment uses `centralus`).

## Why not `azd`?

There is no `azure.yaml` in this repo. Deployment is split: Bicep provisions infrastructure once, GitHub Actions deploys application code on every push to `main` (see [`.github/workflows/azure-mcp-server.yml`](../.github/workflows/azure-mcp-server.yml) and [`.github/workflows/azure-static-web-apps.yml`](../.github/workflows/azure-static-web-apps.yml)). Adding `azure.yaml` for `azd up` is reasonable future work but not currently supported.
