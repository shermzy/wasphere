import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { DEMO_MODE } from "@/lib/demo"
import { serverGet } from "@/lib/server-fetch"
import {
  WORKSPACE_COOKIE,
  type WorkspaceSummary,
} from "@/lib/workspaces"

const SECURE = process.env.NODE_ENV === "production"

export async function POST(request: Request) {
  const cookieStore = await cookies()
  const token = cookieStore.get("wa_access")?.value ?? ""
  if (!token && !DEMO_MODE) {
    return Response.json({ message: "Unauthorized" }, { status: 401 })
  }

  let body: { workspaceId?: unknown }
  try {
    body = await request.json()
  } catch {
    return Response.json({ message: "Invalid request body" }, { status: 400 })
  }

  const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId : ""
  if (!workspaceId) {
    return Response.json({ message: "Workspace ID is required" }, { status: 400 })
  }

  const result = await serverGet<WorkspaceSummary[] | { workspaces: WorkspaceSummary[] }>(
    "/workspaces",
    token,
  )
  if (!result.ok) {
    return Response.json(
      result.data ?? { message: "Could not validate workspace" },
      { status: result.status || 502 },
    )
  }

  const workspaces = Array.isArray(result.data)
    ? result.data
    : (result.data?.workspaces ?? [])
  const workspace = workspaces.find((candidate) => candidate.id === workspaceId)
  if (!workspace) {
    return Response.json({ message: "Workspace not found" }, { status: 404 })
  }

  const response = NextResponse.json({ workspace, selectedWorkspaceId: workspace.id })
  response.cookies.set(WORKSPACE_COOKIE, workspace.id, {
    httpOnly: true,
    secure: SECURE,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  })
  return response
}
