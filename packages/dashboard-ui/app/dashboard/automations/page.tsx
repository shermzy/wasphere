import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { ApiError } from "@/components/ui/api-error"
import { AutomationsView } from "@/components/automations/automations-view"
import type { AutomationRule, Session } from "./types"
import { resolveWorkspaceId, serverGet } from "@/lib/server-fetch"

function listOf<T>(data: T[] | { sessions?: T[] } | null): T[] {
  if (Array.isArray(data)) return data
  return data?.sessions ?? []
}

export default async function AutomationsPage() {
  const token = (await cookies()).get("wa_access")?.value ?? ""
  if (!token) redirect("/login?reason=expired")
  const { workspaceId } = await resolveWorkspaceId(token)
  if (!workspaceId) redirect("/login?reason=expired")

  const [rules, sessions] = await Promise.all([
    serverGet<AutomationRule[]>(`/workspaces/${workspaceId}/automations`, token),
    serverGet<Session[] | { sessions?: Session[] }>(`/workspaces/${workspaceId}/proxy/api/sessions`, token),
  ])

  if (!rules.ok || !Array.isArray(rules.data)) return <ApiError message="Could not load automations." />

  return <AutomationsView key={workspaceId} initialRules={rules.data} initialSessions={listOf(sessions.data)} />
}
