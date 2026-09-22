"use server"

import { cookies } from "next/headers"
import { apiRequest, resolveWorkspaceId } from "@/lib/server-fetch"
import type { ActionResult, AutomationRule, AutomationRun } from "./types"

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
    ? { ok: true, status: result.status, data: result.data as T }
    : { ok: false, status: result.status, message: messageOf(result.data, "The automation request failed.") }
}

export async function createAutomation(input: {
  name: string
  providerSessionId: string
  keyword: string
  responseText: string
}): Promise<ActionResult<AutomationRule>> {
  return request("/automations", "POST", input)
}

export async function updateAutomation(id: string, input: {
  name: string
  providerSessionId: string
  keyword: string
  responseText: string
}): Promise<ActionResult<AutomationRule>> {
  return request(`/automations/${encodeURIComponent(id)}`, "PATCH", input)
}

export async function setAutomationEnabled(id: string, enabled: boolean): Promise<ActionResult<AutomationRule>> {
  return request(`/automations/${encodeURIComponent(id)}/${enabled ? "enable" : "disable"}`, "POST", { confirm: true })
}

export async function listAutomationRuns(id: string): Promise<ActionResult<AutomationRun[]>> {
  return request(`/automations/${encodeURIComponent(id)}/runs`, "GET")
}
