import assert from "node:assert/strict"
import test from "node:test"
import { workspaceSessionId } from "./workspace-session-id.ts"

test("different workspaces receive different provider session IDs", () => {
  assert.equal(
    workspaceSessionId("40a7fd50-610e-4e11-91c4-7ba3397170b3"),
    "workspace-40a7fd50-610e-4e11-91c4-7ba3397170b3",
  )
  assert.equal(
    workspaceSessionId("9882ff21-df3d-4e48-9903-400df42d0241"),
    "workspace-9882ff21-df3d-4e48-9903-400df42d0241",
  )
})
