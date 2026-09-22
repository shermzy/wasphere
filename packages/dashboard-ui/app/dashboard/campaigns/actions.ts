"use server"

import { cookies } from "next/headers"
import { apiRequest, resolveWorkspaceId } from "@/lib/server-fetch"
import type { ActionResult, Campaign, Contact, Session } from "@/components/campaigns/types"

function messageOf(data: unknown, fallback: string): string {
  if (data && typeof data === "object" && "message" in data) {
    const message = (data as { message?: unknown }).message
    return Array.isArray(message) ? message.join("\n") : String(message ?? fallback)
  }
  return fallback
}

async function request<T>(path: string, method: "GET" | "POST" | "PATCH", body?: unknown): Promise<ActionResult<T>> {
  const token = (await cookies()).get("wa_access")?.value
  if (!token) return { ok: false, status: 401, message: "Your session has expired." }
  const { workspaceId } = await resolveWorkspaceId(token)
  if (!workspaceId) return { ok: false, status: 404, message: "No workspace is selected." }
  const result = await apiRequest<T>(`/workspaces/${workspaceId}${path}`, method, token, body)
  return result.ok
    ? { ok: true, status: result.status, data: result.data }
    : { ok: false, status: result.status, message: messageOf(result.data, "The campaign request failed.") }
}

export async function listCampaignContacts(search = ""): Promise<ActionResult<{ items: Contact[] }>> {
  const query = search.trim() ? `?search=${encodeURIComponent(search.trim())}&limit=100` : "?limit=100"
  return request(`/contacts${query}`, "GET")
}

export async function getCampaign(id: string): Promise<ActionResult<Campaign>> {
  return request(`/campaigns/${encodeURIComponent(id)}`, "GET")
}

export async function createCampaign(input: { name: string; providerSessionId: string; message: string; contactIds: string[] }): Promise<ActionResult<Campaign>> {
  return request("/campaigns", "POST", input)
}

export async function updateCampaign(id: string, input: { name: string; providerSessionId: string; message: string; contactIds: string[] }): Promise<ActionResult<Campaign>> {
  return request(`/campaigns/${encodeURIComponent(id)}`, "PATCH", input)
}

export async function scheduleCampaign(id: string, scheduledAt: string): Promise<ActionResult<Campaign>> {
  return request(`/campaigns/${encodeURIComponent(id)}/schedule`, "POST", { scheduledAt })
}

export async function launchCampaign(id: string): Promise<ActionResult<Campaign>> {
  return request(`/campaigns/${encodeURIComponent(id)}/launch`, "POST", { confirm: true })
}

export async function cancelCampaign(id: string): Promise<ActionResult<Campaign>> {
  return request(`/campaigns/${encodeURIComponent(id)}/cancel`, "POST")
}

export async function listCampaignSessions(): Promise<ActionResult<Session[]>> {
  const token = (await cookies()).get("wa_access")?.value
  if (!token) return { ok: false, status: 401, message: "Your session has expired." }
  const { workspaceId } = await resolveWorkspaceId(token)
  if (!workspaceId) return { ok: false, status: 404, message: "No workspace is selected." }
  const result = await apiRequest<Session[] | { sessions?: Session[] }>(`/workspaces/${workspaceId}/proxy/api/sessions`, "GET", token)
  if (!result.ok) return { ok: false, status: result.status, message: messageOf(result.data, "Could not load connected sessions.") }
  const sessions = Array.isArray(result.data) ? result.data : result.data?.sessions ?? []
  return { ok: true, status: result.status, data: sessions }
}
