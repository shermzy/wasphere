import { cookies } from "next/headers"
import { serverGet, serverPost, resolveWorkspaceId } from "@/lib/server-fetch"

export async function GET() {
  const token = (await cookies()).get("wa_access")?.value
  if (!token) return Response.json({ message: "Unauthorized" }, { status: 401 })
  const { workspaceId, wsError } = await resolveWorkspaceId(token)
  if (!workspaceId) return wsError!
  const { data, status } = await serverGet(`/workspaces/${workspaceId}/projects`, token)
  return Response.json(data ?? { message: "Upstream error" }, { status })
}

export async function POST(req: Request) {
  const token = (await cookies()).get("wa_access")?.value
  if (!token) return Response.json({ message: "Unauthorized" }, { status: 401 })
  const { workspaceId, wsError } = await resolveWorkspaceId(token)
  if (!workspaceId) return wsError!
  const body = await req.json().catch(() => ({}))
  const { data, status } = await serverPost(`/workspaces/${workspaceId}/projects`, token, body)
  return Response.json(data ?? { message: "Upstream error" }, { status })
}
