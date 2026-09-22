import assert from "node:assert/strict"
import test from "node:test"
import { mergeUniqueById } from "./pagination.ts"

test("merges cursor pages without duplicating rows", () => {
  assert.deepEqual(
    mergeUniqueById([{ id: "new", value: 1 }, { id: "shared", value: 2 }], [{ id: "shared", value: 3 }, { id: "old", value: 4 }]),
    [{ id: "new", value: 1 }, { id: "shared", value: 2 }, { id: "old", value: 4 }],
  )
})
