import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { resolveWorkspaceId, serverGet } from "@/lib/server-fetch"
import { DEMO_MODE } from "@/lib/demo"
import { InboxView } from "@/components/inbox/inbox-view"
import type { Conversation, Paginated } from "@/components/inbox/types"
import type { ProjectRoute } from "@/components/projects/types"

async function fetchWorkspaceId(token: string): Promise<string | null> {
  const { workspaceId } = await resolveWorkspaceId(token)
  return workspaceId
}

export default async function InboxPage() {
  // DEMO_MODE serves seeded fixtures with no auth (serverGet returns demo data).
  const token = (await cookies()).get("wa_access")?.value ?? ""
  if (!DEMO_MODE && !token) redirect("/login?reason=expired")

  const workspaceId = await fetchWorkspaceId(token)
  if (!workspaceId) redirect("/login?reason=expired")

  const { data } = await serverGet<Paginated<Conversation>>(
    `/workspaces/${workspaceId}/conversations?status=OPEN&limit=50`,
    token,
  )
  const projects = await serverGet<ProjectRoute[]>(`/workspaces/${workspaceId}/projects`, token)

  return <InboxView initialConversations={data?.items ?? []} initialProjects={projects.data ?? []} />
}
