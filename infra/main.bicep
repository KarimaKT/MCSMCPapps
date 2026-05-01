// Azure Static Web App for hosting the MCSMCPapps WebChat UI.
// Free SKU; tenant-agnostic. Region defaults to West US 2 (SWA-supported).
// See https://learn.microsoft.com/azure/static-web-apps/

@description('Static Web App name. Must be globally unique within the resource group scope.')
param swaName string = 'swa-mcsmcpapps'

@description('Region for the Static Web App. Free SKU supports a limited set of regions.')
@allowed([
  'westus2'
  'eastus2'
  'eastasia'
  'westeurope'
  'centralus'
])
param location string = 'westus2'

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
    // Provider+repo wiring is created by the GitHub Actions workflow; we just
    // create the empty SWA shell here so that `az staticwebapp secrets list`
    // returns a deployment token to feed back into the workflow.
    provider: 'None'
    allowConfigFileUpdates: true
    stagingEnvironmentPolicy: 'Enabled'
  }
}

output staticWebAppName string = swa.name
output defaultHostname string = swa.properties.defaultHostname
