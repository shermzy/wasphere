import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { DEMO_MODE } from "@/lib/demo"
import { serverGet, serverPost } from "@/lib/server-fetch"
import {
  WORKSPACE_COOKIE,
  type WorkspaceListResponse,
  type WorkspaceSummary,
} from "@/lib/workspaces"

const SECURE = process.env.NODE_ENV === "production"
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30

function workspaceCookieOptions() {
  return {
    httpOnly: true,
    secure: SECURE,
    sameSite: "lax" as const,
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  }
}

function asWorkspaceList(
  data: WorkspaceSummary[] | { workspaces: WorkspaceSummary[] } | null,
): WorkspaceSummary[] {
  if (!data) return []
  return Array.isArray(data) ? data : (data.workspaces ?? [])
}

export async function GET() {
  const cookieStore = await cookies()
  const token = cookieStore.get("wa_access")?.value ?? ""
  if (!token && !DEMO_MODE) {
    return Response.json({ message: "Unauthorized" }, { status: 401 })
  }

  const result = await serverGet<WorkspaceSummary[] | { workspaces: WorkspaceSummary[] }>(
    "/workspaces",
    token,
  )
  if (!result.ok) {
    return Response.json(
      result.data ?? { message: "Could not load workspaces" },
      { status: result.status || 502 },
    )
  }

  const workspaces = asWorkspaceList(result.data)
  const storedId = cookieStore.get(WORKSPACE_COOKIE)?.value
  const selectedWorkspaceId = workspaces.some((workspace) => workspace.id === storedId)
    ? storedId!
    : workspaces[0]?.id ?? null

  const response: WorkspaceListResponse = { workspaces, selectedWorkspaceId }
  const nextResponse = NextResponse.json(response)
  if (selectedWorkspaceId) {
    nextResponse.cookies.set(WORKSPACE_COOKIE, selectedWorkspaceId, workspaceCookieOptions())
  } else if (cookieStore.has(WORKSPACE_COOKIE)) {
    nextResponse.cookies.set(WORKSPACE_COOKIE, "", { maxAge: 0, path: "/" })
  }
  return nextResponse
}

export async function POST(request: Request) {
  const cookieStore = await cookies()
  const token = cookieStore.get("wa_access")?.value ?? ""
  if (!token && !DEMO_MODE) {
    return Response.json({ message: "Unauthorized" }, { status: 401 })
  }
  if (DEMO_MODE) {
    return Response.json({ message: "Workspace creation is disabled in demo mode" }, { status: 403 })
  }

  let body: { name?: unknown }
  try {
    body = await request.json()
  } catch {
    return Response.json({ message: "Invalid request body" }, { status: 400 })
  }

  const name = typeof body.name === "string" ? body.name.trim() : ""
  if (!name) return Response.json({ message: "Workspace name is required" }, { status: 400 })
  if (name.length > 80) {
    return Response.json({ message: "Workspace name must be 80 characters or fewer" }, { status: 400 })
  }

  const result = await serverPost<{ id: string; name: string; message?: string }>(
    "/workspaces",
    token,
    { name },
  )
  if (!result.ok || !result.data?.id) {
    return Response.json(
      result.data ?? { message: "Could not create workspace" },
      { status: result.status || 502 },
    )
  }

  const response = NextResponse.json(
    { workspace: result.data, selectedWorkspaceId: result.data.id },
    { status: 201 },
  )
  response.cookies.set(WORKSPACE_COOKIE, result.data.id, workspaceCookieOptions())
  return response
}
