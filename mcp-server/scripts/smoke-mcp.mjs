#!/usr/bin/env node
/**
 * MCP HTTP smoke test.
 *
 * Posts `initialize`, `tools/list`, `resources/list`, and a no-op
 * `tools/call` against a running MCP server (local dev or production)
 * and asserts the locked-contract surface from
 * [docs/decisions/0005-arg-optionality-is-locked.md] is intact:
 *
 *   - tool name `openCopilotStudioChat` present
 *   - `userQuery` arg is REQUIRED (in `required[]`)
 *   - `conversationId` arg is OPTIONAL (NOT in `required[]`, type string)
 *   - tool description is one short sentence (< 220 chars)
 *   - tool count === 2 (openCopilotStudioChat + submitAdaptiveCardAction)
 *   - resource `ui://mcsmcpapps/chat` registered with MIME `text/html+skybridge`
 *   - tool _meta has `openai/outputTemplate` pointing at the resource
 *   - `tools/call` round-trips: structuredContent has expected keys
 *
 * Exit code 0 on pass, non-zero on any failure.
 *
 * # Usage
 *
 *   # Local (no auth)
 *   node mcp-server/scripts/smoke-mcp.mjs http://localhost:3000/mcp
 *
 *   # Live (Entra SSO enabled)
 *   $env:MCP_BEARER = az account get-access-token \
 *     --resource api://<ENTRA_AUDIENCE>/.default \
 *     --query accessToken -o tsv
 *   node mcp-server/scripts/smoke-mcp.mjs https://app-mcsmcpapps-mcp.azurewebsites.net/mcp
 *
 * # Wire into CI
 *
 * After deploy, GitHub Actions runs this with the production endpoint
 * and a service-principal token; if it fails, the deploy is rolled back.
 * (Token minting is the harder part; for v1 this script runs locally
 * before push.)
 *
 * # What it deliberately does NOT do
 *
 *   - Does not call CS Direct Engine (that's `test-cs-local.mjs`)
 *   - Does not test the widget bundle (that's S01 in SMOKE-CHECKLIST.md)
 *   - Does not validate the published manifest matches (that's the
 *     contracts-lock guard, see docs/PROGRESS.md "deferred work")
 */

const url = process.argv[2];
if (!url) {
  console.error(
    'Usage: smoke-mcp.mjs <mcpUrl> [--call-userQuery <text>]\n' +
      '  mcpUrl: the /mcp endpoint, e.g. http://localhost:3000/mcp'
  );
  process.exit(2);
}
const callUserQuery =
  (process.argv.includes('--call-userQuery') &&
    process.argv[process.argv.indexOf('--call-userQuery') + 1]) ||
  null;

const bearer = process.env.MCP_BEARER || null;
const headers = {
  'Content-Type': 'application/json',
  Accept: 'application/json, text/event-stream'
};
if (bearer) headers.Authorization = `Bearer ${bearer}`;

let nextId = 1;
const failures = [];
function assert(condition, message) {
  if (condition) {
    console.log(`  PASS  ${message}`);
  } else {
    console.error(`  FAIL  ${message}`);
    failures.push(message);
  }
}

async function rpc(method, params = {}) {
  const id = nextId++;
  const body = JSON.stringify({ jsonrpc: '2.0', id, method, params });
  const res = await fetch(url, { method: 'POST', headers, body });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `${method} → HTTP ${res.status}: ${text.slice(0, 400)}`
    );
  }
  // Stateless transport with enableJsonResponse returns plain JSON.
  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new Error(
      `${method} → non-JSON response: ${text.slice(0, 400)}`
    );
  }
  if (json.error) {
    throw new Error(
      `${method} → JSON-RPC error ${json.error.code}: ${json.error.message}`
    );
  }
  return json.result;
}

console.log(`smoke-mcp: ${url}`);
console.log(`  auth: ${bearer ? 'Bearer present' : 'no Bearer (anonymous)'}`);
console.log('');

// ---------------------------------------------------------------------------
// initialize
// ---------------------------------------------------------------------------
console.log('initialize');
const init = await rpc('initialize', {
  protocolVersion: '2024-11-05',
  capabilities: {},
  clientInfo: { name: 'smoke-mcp', version: '0.1.0' }
});
assert(
  init?.serverInfo?.name === 'mcsmcpapps',
  `serverInfo.name === "mcsmcpapps" (got "${init?.serverInfo?.name}")`
);
assert(
  typeof init?.serverInfo?.version === 'string',
  `serverInfo.version is a string (got ${typeof init?.serverInfo?.version})`
);
console.log('');

// ---------------------------------------------------------------------------
// tools/list — assert the locked contract
// ---------------------------------------------------------------------------
console.log('tools/list');
const toolsList = await rpc('tools/list', {});
const tools = toolsList?.tools ?? [];
assert(tools.length === 2, `tool count === 2 (got ${tools.length})`);

const openTool = tools.find((t) => t.name === 'openCopilotStudioChat');
assert(!!openTool, 'tool "openCopilotStudioChat" present');
const submitTool = tools.find((t) => t.name === 'submitAdaptiveCardAction');
assert(!!submitTool, 'tool "submitAdaptiveCardAction" present');

if (openTool) {
  const props = openTool.inputSchema?.properties ?? {};
  const required = openTool.inputSchema?.required ?? [];
  assert(
    'userQuery' in props && props.userQuery?.type === 'string',
    'openCopilotStudioChat.userQuery is string'
  );
  assert(
    required.includes('userQuery'),
    'openCopilotStudioChat.userQuery is REQUIRED'
  );
  assert(
    'conversationId' in props && props.conversationId?.type === 'string',
    'openCopilotStudioChat.conversationId is string'
  );
  assert(
    !required.includes('conversationId'),
    'openCopilotStudioChat.conversationId is OPTIONAL (not in required[])'
  );
  assert(
    typeof openTool.description === 'string' &&
      openTool.description.length > 0 &&
      openTool.description.length < 220,
    `openCopilotStudioChat.description is one short sentence (len=${openTool.description?.length ?? 0})`
  );
  const meta = openTool._meta ?? {};
  assert(
    meta['openai/outputTemplate'] === 'ui://mcsmcpapps/chat',
    'openCopilotStudioChat._meta["openai/outputTemplate"] is ui://mcsmcpapps/chat'
  );
  assert(
    meta['openai/widgetAccessible'] === true,
    'openCopilotStudioChat._meta["openai/widgetAccessible"] === true'
  );
}

if (submitTool) {
  const props = submitTool.inputSchema?.properties ?? {};
  const required = submitTool.inputSchema?.required ?? [];
  assert(
    required.includes('conversationId'),
    'submitAdaptiveCardAction.conversationId is REQUIRED'
  );
  assert(
    'value' in props,
    'submitAdaptiveCardAction.value is present'
  );
}
console.log('');

// ---------------------------------------------------------------------------
// resources/list — assert widget resource registered with skybridge MIME
// ---------------------------------------------------------------------------
console.log('resources/list');
const resourcesList = await rpc('resources/list', {});
const resources = resourcesList?.resources ?? [];
const chatResource = resources.find(
  (r) => r.uri === 'ui://mcsmcpapps/chat'
);
assert(!!chatResource, 'resource "ui://mcsmcpapps/chat" registered');
if (chatResource) {
  assert(
    chatResource.mimeType === 'text/html+skybridge',
    `chat resource MIME is text/html+skybridge (got "${chatResource.mimeType}")`
  );
  const meta = chatResource._meta ?? {};
  assert(
    meta['openai/outputTemplate'] === 'ui://mcsmcpapps/chat',
    'chat resource _meta["openai/outputTemplate"] is ui://mcsmcpapps/chat'
  );
  assert(
    meta['openai/widgetAccessible'] === true,
    'chat resource _meta["openai/widgetAccessible"] === true'
  );
}
console.log('');

// ---------------------------------------------------------------------------
// tools/call (only if user opted in via --call-userQuery)
// ---------------------------------------------------------------------------
if (callUserQuery) {
  console.log(`tools/call openCopilotStudioChat (userQuery="${callUserQuery}")`);
  const t0 = Date.now();
  const callResult = await rpc('tools/call', {
    name: 'openCopilotStudioChat',
    arguments: { userQuery: callUserQuery }
  });
  const ms = Date.now() - t0;
  console.log(`  (took ${ms}ms)`);
  const sc = callResult?.structuredContent ?? {};
  assert(
    typeof sc.replyText === 'string',
    'structuredContent.replyText is a string'
  );
  assert(
    'conversationId' in sc,
    'structuredContent.conversationId present (may be null/string)'
  );
  assert(
    Array.isArray(sc.adaptiveCards ?? []),
    'structuredContent.adaptiveCards is an array (or absent)'
  );
  const callMeta = callResult?._meta ?? {};
  assert(
    callMeta['openai/outputTemplate'] === 'ui://mcsmcpapps/chat',
    'tools/call response _meta carries the outputTemplate'
  );
  console.log('');
} else {
  console.log(
    '(skipping tools/call — pass --call-userQuery "<text>" to exercise CS round-trip)\n'
  );
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
if (failures.length === 0) {
  console.log('OK — all assertions passed');
  process.exit(0);
} else {
  console.error(`FAIL — ${failures.length} assertion(s) failed:`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
