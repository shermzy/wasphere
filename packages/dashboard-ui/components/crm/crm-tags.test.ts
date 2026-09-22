import assert from "node:assert/strict"
import test from "node:test"
import { parseCrmStage, replaceCrmStage } from "./crm-tags.ts"

test("replaces CRM stage with one exact tag and preserves deduped ordinary tags", () => {
  assert.deepEqual(
    replaceCrmStage(["VIP", "vip", "crm:Lead", "region:sg", "crm:lead"], "Qualified"),
    ["VIP", "region:sg", "crm:Qualified"],
  )
})

test("parses only one exact recognized CRM stage", () => {
  assert.equal(parseCrmStage(["crm:Customer", "vip"]), "Customer")
  assert.equal(parseCrmStage(["crm:customer"]), null)
  assert.equal(parseCrmStage(["crm:Lead", "crm:Customer"]), null)
})
