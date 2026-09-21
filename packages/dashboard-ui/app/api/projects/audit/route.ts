import { cookies } from "next/headers"
import { resolveWorkspaceId, serverGet } from "@/lib/server-fetch"

export async function GET(req: Request) {
  const token = (await cookies()).get("wa_access")?.value
  if (!token) return Response.json({ message: "Unauthorized" }, { status: 401 })
  const { workspaceId, wsError } = await resolveWorkspaceId(token)
  if (!workspaceId) return wsError!
  const params = new URL(req.url).searchParams
  if (!params.has("limit")) params.set("limit", "50")
  const { data, status } = await serverGet(`/workspaces/${workspaceId}/projects/audit?${params.toString()}`, token)
  return Response.json(data ?? { message: "Upstream error" }, { status })
}
