"use server"

import { cookies } from "next/headers"
import { apiRequest, resolveWorkspaceId } from "@/lib/server-fetch"
import type { AiReplyActionResult, AiReplyDraft } from "@/components/ai-replies/types"

function messageOf(data: unknown, fallback: string): string {
  if (data && typeof data === "object" && "message" in data) {
    const message = (data as { message?: unknown }).message
    return Array.isArray(message) ? message.join("\n") : String(message ?? fallback)
  }
  return fallback
}

export async function generateAiReply(input: {
  conversationId: string
  tone?: string
  instruction?: string
}): Promise<AiReplyActionResult<AiReplyDraft>> {
  const token = (await cookies()).get("wa_access")?.value
  if (!token) return { ok: false, status: 401, message: "Your session has expired." }
  const { workspaceId } = await resolveWorkspaceId(token)
  if (!workspaceId) return { ok: false, status: 404, message: "No workspace is selected." }

  const result = await apiRequest<AiReplyDraft>(
    "/workspaces/" + workspaceId + "/ai-replies/draft",
    "POST",
    token,
    input,
  )
  return result.ok
    ? { ok: true, status: result.status, data: result.data ?? undefined }
    : { ok: false, status: result.status, message: messageOf(result.data, "Could not generate a draft.") }
}
