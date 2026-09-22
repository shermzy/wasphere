import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { ApiError } from "@/components/ui/api-error"
import { CampaignsView } from "@/components/campaigns/campaigns-view"
import type { Campaign, Contact, Session } from "@/components/campaigns/types"
import { resolveWorkspaceId, serverGet } from "@/lib/server-fetch"

function listOf<T>(data: T[] | { items?: T[]; sessions?: T[] } | null): T[] {
  if (Array.isArray(data)) return data
  if (data && "items" in data && Array.isArray(data.items)) return data.items
  if (data && "sessions" in data && Array.isArray(data.sessions)) return data.sessions
  return []
}

export default async function CampaignsPage() {
  const token = (await cookies()).get("wa_access")?.value ?? ""
  if (!token) redirect("/login?reason=expired")
  const { workspaceId } = await resolveWorkspaceId(token)
  if (!workspaceId) redirect("/login?reason=expired")

  const [campaigns, contacts, sessions] = await Promise.all([
    serverGet<Campaign[]>(`/workspaces/${workspaceId}/campaigns`, token),
    serverGet<{ items: Contact[] }>(`/workspaces/${workspaceId}/contacts?limit=100`, token),
    serverGet<Session[] | { sessions?: Session[] }>(`/workspaces/${workspaceId}/proxy/api/sessions`, token),
  ])

  if (!campaigns.ok || !Array.isArray(campaigns.data)) return <ApiError message="Could not load campaigns." />

  return <CampaignsView key={workspaceId} initialCampaigns={campaigns.data} initialContacts={listOf(contacts.data)} initialSessions={listOf(sessions.data)} />
}
