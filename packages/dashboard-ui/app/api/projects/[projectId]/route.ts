import { cookies } from "next/headers"
import { serverDelete, serverPatch, resolveWorkspaceId } from "@/lib/server-fetch"

type Params = { params: Promise<{ projectId: string }> }

async function authWorkspace() {
  const token = (await cookies()).get("wa_access")?.value
  if (!token) return { token: null, response: Response.json({ message: "Unauthorized" }, { status: 401 }) }
  const resolved = await resolveWorkspaceId(token)
  if (!resolved.workspaceId) return { token: null, response: resolved.wsError! }
  return { token, workspaceId: resolved.workspaceId, response: null }
}

export async function PATCH(req: Request, { params }: Params) {
  const auth = await authWorkspace()
  if (!auth.token || !auth.workspaceId) return auth.response!
  const { projectId } = await params
  const body = await req.json().catch(() => ({}))
  const { data, status } = await serverPatch(`/workspaces/${auth.workspaceId}/projects/${projectId}`, auth.token, body)
  return Response.json(data ?? { message: "Upstream error" }, { status })
}

export async function DELETE(_req: Request, { params }: Params) {
  const auth = await authWorkspace()
  if (!auth.token || !auth.workspaceId) return auth.response!
  const { projectId } = await params
  const { data, status } = await serverDelete(`/workspaces/${auth.workspaceId}/projects/${projectId}`, auth.token)
  return Response.json(data ?? { message: "Upstream error" }, { status })
}
