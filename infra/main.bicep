// Azure resources for hosting MCSMCPapps:
//   - Static Web App (Free SKU) for the WebChat (Phase 4)
//   - App Service (Linux, F1 Free SKU) for the MCP server (Phase 5)
// Both tenant-agnostic; both deployed to the same resource group.

@description('Static Web App name. Must be globally unique within the resource group scope.')
param swaName string = 'swa-mcsmcpapps'

@description('App Service Plan name (Linux). Will host the MCP server.')
param mcpPlanName string = 'plan-mcsmcpapps-mcp'

@description('App Service name (Linux Node). Will host the MCP server.')
param mcpAppName string = 'app-mcsmcpapps-mcp'

@description('Region for the Static Web App. Free SKU supports a limited set of regions.')
@allowed([
  'westus2'
  'eastus2'
  'eastasia'
  'westeurope'
  'centralus'
])
param location string = 'westus2'

@description('Region for the App Service hosting the MCP server. Independent of SWA region; quota varies.')
param mcpLocation string = location

@description('Display name baked into the MCP tool description.')
param mcpAgentName string = 'Copilot Studio Agent'

@description('Description shown to the user when the DA invokes the tool.')
param mcpAgentDescription string = 'Open the embedded Copilot Studio chat surface.'

@description('Origin of the Static Web App, used by the MCP widget. Set after the SWA is deployed.')
param swaOrigin string = ''

@description('Tags applied to all resources.')
param tags object = {
  project: 'MCSMCPapps'
  owner: 'karima'
  cost: 'experimental'
}

resource swa 'Microsoft.Web/staticSites@2024-04-01' = {
  name: swaName
  location: location
  tags: tags
  sku: {
    name: 'Free'
    tier: 'Free'
  }
  properties: {
    provider: 'None'
    allowConfigFileUpdates: true
    stagingEnvironmentPolicy: 'Enabled'
  }
}

resource mcpPlan 'Microsoft.Web/serverfarms@2024-04-01' = {
  name: mcpPlanName
  location: mcpLocation
  tags: tags
  sku: {
    // B1 Basic: ~$13/mo. Fits comfortably in the $150 VS credit.
    // (F1 Free was tried first but Free-tier VM quota was 0 on the
    // subscription. Request quota or stay on B1.)
    name: 'B1'
    tier: 'Basic'
  }
  kind: 'linux'
  properties: {
    reserved: true // required for Linux
  }
}

resource mcpApp 'Microsoft.Web/sites@2024-04-01' = {
  name: mcpAppName
  location: mcpLocation
  tags: tags
  kind: 'app,linux'
  properties: {
    serverFarmId: mcpPlan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'NODE|20-lts'
      alwaysOn: true
      // Allow Microsoft 365 Copilot's widget host to call the MCP server.
      // The DA tool invocation crosses origins; Copilot adds CORS preflights.
      cors: {
        allowedOrigins: [
          'https://m365.cloud.microsoft'
          'https://*.cloud.microsoft'
          'https://copilot.microsoft.com'
          'https://outlook.office.com'
          'https://teams.microsoft.com'
        ]
        supportCredentials: false
      }
      appSettings: [
        // App Service builds the project on deploy when this is true.
        {
          name: 'SCM_DO_BUILD_DURING_DEPLOYMENT'
          value: 'true'
        }
        {
          name: 'WEBSITE_NODE_DEFAULT_VERSION'
          value: '~20'
        }
        // MCP server runtime config.
        {
          name: 'SWA_ORIGIN'
          value: swaOrigin
        }
        {
          name: 'AGENT_NAME'
          value: mcpAgentName
        }
        {
          name: 'AGENT_DESCRIPTION'
          value: mcpAgentDescription
        }
        // App Service injects PORT itself; we read it in config.ts.
      ]
    }
  }
}

output staticWebAppName string = swa.name
output defaultHostname string = swa.properties.defaultHostname
output mcpAppHostname string = mcpApp.properties.defaultHostName
output mcpAppName string = mcpApp.name
output mcpEndpoint string = 'https://${mcpApp.properties.defaultHostName}/mcp'
