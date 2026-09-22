import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { AiRepliesView } from "@/components/ai-replies/ai-replies-view"
import type { AiReplyStatus } from "@/components/ai-replies/types"
import { resolveWorkspaceId, serverGet } from "@/lib/server-fetch"

interface AiRepliesPageProps {
  searchParams: Promise<{ conversationId?: string }>
}

export default async function AiRepliesPage({ searchParams }: AiRepliesPageProps) {
  const token = (await cookies()).get("wa_access")?.value ?? ""
  if (!token) redirect("/login?reason=expired")

  const { workspaceId } = await resolveWorkspaceId(token)
  if (!workspaceId) redirect("/login?reason=expired")

  const status = await serverGet<AiReplyStatus>("/workspaces/" + workspaceId + "/ai-replies/status", token)
  const params = await searchParams

  return (
    <AiRepliesView
      key={workspaceId}
      configured={status.ok && status.data?.configured === true}
      initialConversationId={params.conversationId ?? ""}
    />
  )
}
