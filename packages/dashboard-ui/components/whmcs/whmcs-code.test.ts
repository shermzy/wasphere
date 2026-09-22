import assert from "node:assert/strict"
import test from "node:test"
import {
  generateWhmcsPhp,
  getDefaultWhmcsEvents,
} from "./whmcs-code.ts"

test("generates escaped, fail-closed WHMCS PHP for the dashboard text proxy", () => {
  const events = getDefaultWhmcsEvents()
  events.OrderPaid = { enabled: false, template: "disabled" }
  events.InvoiceCreated = { enabled: true, template: "O'Reilly \\\\ invoice\n{invoice_id}" }

  const source = generateWhmcsPhp({
    apiUrl: "https://dashboard.example.test/",
    workspaceId: "workspace-'quoted\\path",
    sessionId: "session-42",
    optInField: "WhatsApp 'Opt-In'",
    optInValues: ["yes", "on\\line"],
    events,
  })

  assert.ok(source.includes("'bound_api_url' => 'https://dashboard.example.test'"))
  assert.ok(source.includes("'bound_workspace_id' => 'workspace-\\'quoted\\\\path'"))
  assert.ok(source.includes("'bound_session_id' => 'session-42'"))
  assert.ok(source.includes("'opt_in_field' => 'WhatsApp \\'Opt-In\\''"))
  assert.ok(source.includes("'opt_in_values' => ['yes', 'on\\\\line']"))
  assert.ok(source.includes("O\\'Reilly"))
  assert.ok(source.includes("invoice\n{invoice_id}"))

  assert.doesNotMatch(source, /raw-api-key-must-not-appear/)
  assert.match(source, /getenv\('WASPHERE_API_KEY'\)/)
  assert.match(source, /\$config\['api_url'\] !== \(\$config\['bound_api_url'\] \?\? ''\)/)
  assert.match(source, /\$config\['workspace_id'\] !== \(\$config\['bound_workspace_id'\] \?\? ''\)/)
  assert.match(source, /\$config\['session_id'\] !== \(\$config\['bound_session_id'\] \?\? ''\)/)

  assert.match(source, /foreach \(array_keys\(\$config\['events'\] \?\? \[\]\) as \$event\)/)
  assert.match(source, /\$config\['events'\]\[\$event\]\['enabled'\] \?\? false\) !== true/)
  assert.match(source, /'OrderPaid' => \[\n      'enabled' => false/)
  assert.match(source, /'InvoiceCreated' => \[\n      'enabled' => true/)

  assert.match(
    source,
    /\/workspaces\/'[\s\S]*rawurlencode\(\$config\['workspace_id'\]\)[\s\S]*\/proxy\/api\/sessions\/'[\s\S]*rawurlencode\(\$config\['session_id'\]\)[\s\S]*\/messages\/text/,
  )
  assert.match(source, /CURLOPT_FOLLOWLOCATION => false/)
  assert.match(source, /CURLOPT_CONNECTTIMEOUT => self::CONNECT_TIMEOUT_SECONDS/)
  assert.match(source, /CURLOPT_TIMEOUT => self::REQUEST_TIMEOUT_SECONDS/)
  assert.match(source, /if \(\$status < 200 \|\| \$status >= 300\)/)
  assert.match(source, /logActivity\('WaSphere WHMCS integration: ' \. \$event/)
})
