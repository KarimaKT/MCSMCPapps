// Local smoke test for cs.ts.
// Bypasses OBO: uses a delegated Power Platform token from `az`.
// Run from mcp-server/:
//   $env:CS_PP_TOKEN = az account get-access-token --resource https://api.powerplatform.com --query accessToken -o tsv
//   node test-cs-local.mjs "what is the inflation versus gdp in greece"
import { callCsAgent } from './dist/cs.js';

const ppToken = process.env.CS_PP_TOKEN;
if (!ppToken) {
  console.error('Set CS_PP_TOKEN to a Power Platform access token first.');
  process.exit(2);
}
const userQuery = process.argv[2] || 'hello';

const t0 = Date.now();
const r = await callCsAgent({
  envId: '61453fde-f312-e19f-b879-a2dfa518e914',
  schema: 'ksteam_ak001',
  ppToken,
  userQuery,
  hardTimeoutMs: 30000
});
const ms = Date.now() - t0;
console.log('---');
console.log('totalMs:', ms);
console.log('replyText:', JSON.stringify(r.replyText));
console.log('citations:', r.citations?.length ?? 0);
console.log('chartData?:', !!r.chartData);
console.log('conversationId:', r.conversationId ? String(r.conversationId).slice(0, 12) + '...' : null);
console.log('diag:', r.diag);
process.exit(r.diag.ok ? 0 : 1);
