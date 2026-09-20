import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { DeveloperPanel } from "@/components/developer/developer-panel"

import { resolveWorkspaceId, serverGet } from "@/lib/server-fetch"

interface Workspace {
  id: string
  name: string
  waServerConfigured: boolean
  waServerUrl?: string | null
}

async function fetchWorkspace(token: string): Promise<Workspace | null> {
  const { workspaceId } = await resolveWorkspaceId(token)
  if (!workspaceId) return null

  const detail = await serverGet<Workspace>(`/workspaces/${workspaceId}`, token)
  return detail.ok ? detail.data : null
}

export default async function DeveloperPage() {
  const cookieStore = await cookies()
  let token = cookieStore.get("wa_access")?.value ?? ""

  if (!token) redirect("/login?reason=expired")

  let workspace = await fetchWorkspace(token)

  if (!workspace) {
    redirect("/login?reason=expired")
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Developer</h1>
      <DeveloperPanel waServerUrl={workspace.waServerUrl ?? null} />
    </div>
  )
}
