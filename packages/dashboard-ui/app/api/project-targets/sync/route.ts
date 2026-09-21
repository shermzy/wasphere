import { cookies } from "next/headers"
import { resolveWorkspaceId, serverPost } from "@/lib/server-fetch"

export async function POST(req: Request) {
  const token = (await cookies()).get("wa_access")?.value
  if (!token) return Response.json({ message: "Unauthorized" }, { status: 401 })
  const { workspaceId, wsError } = await resolveWorkspaceId(token)
  if (!workspaceId) return wsError!
  const body = await req.json().catch(() => ({}))
  const { data, status } = await serverPost(`/workspaces/${workspaceId}/project-targets/sync`, token, body)
  return Response.json(data ?? { message: "Upstream error" }, { status })
}
