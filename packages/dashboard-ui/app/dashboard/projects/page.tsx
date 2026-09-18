import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { ApiError } from "@/components/ui/api-error"
import { ProjectsView } from "@/components/projects/projects-view"
import type { ProjectRoute } from "@/components/projects/types"
import { serverGet } from "@/lib/server-fetch"

async function workspaceId(token: string): Promise<string | null> {
  const { ok, data } = await serverGet<Array<{ id: string }> | { workspaces: Array<{ id: string }> }>("/workspaces", token)
  if (!ok || !data) return null
  const rows = Array.isArray(data) ? data : (data.workspaces ?? [])
  return rows[0]?.id ?? null
}

export default async function ProjectsPage() {
  const token = (await cookies()).get("wa_access")?.value ?? ""
  if (!token) redirect("/login?reason=expired")
  const id = await workspaceId(token)
  if (!id) redirect("/login?reason=expired")
  const result = await serverGet<ProjectRoute[]>(`/workspaces/${id}/projects`, token)
  if (!result.ok || !Array.isArray(result.data)) {
    return <ApiError message="Could not load projects. Check your workspace connection." />
  }
  return <ProjectsView initialProjects={result.data} />
}
