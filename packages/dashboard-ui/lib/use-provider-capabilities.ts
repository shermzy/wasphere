"use client"

import * as React from "react"
import { apiErrorMessage } from "./api-error"

export type ProviderId = "baileys" | "meta"

export type ProviderCapabilities = {
  groups: boolean
  presence: boolean
  profileEdit: boolean
  polls: boolean
  templates: boolean
  flows: boolean
  interactiveButtons: boolean
  reactions: boolean
  viewOnce: boolean
  mediaUpload: boolean
  freeformAlways: boolean
}

export type ProviderCapabilitiesState = "idle" | "loading" | "ready" | "error"

export type ProviderCapabilitiesResult = {
  sessionId: string | null
  state: ProviderCapabilitiesState
  provider: ProviderId | null
  capabilities: ProviderCapabilities | null
  error: string | null
}

const CAPABILITY_KEYS: (keyof ProviderCapabilities)[] = [
  "groups",
  "presence",
  "profileEdit",
  "polls",
  "templates",
  "flows",
  "interactiveButtons",
  "reactions",
  "viewOnce",
  "mediaUpload",
  "freeformAlways",
]

function parseCapabilities(data: unknown): { provider: ProviderId; capabilities: ProviderCapabilities } | null {
  if (!data || typeof data !== "object") return null
  const record = data as Record<string, unknown>
  const provider = record.provider
  const raw = record.capabilities
  if ((provider !== "baileys" && provider !== "meta") || !raw || typeof raw !== "object") return null

  const capabilities = raw as Record<string, unknown>
  if (CAPABILITY_KEYS.some((key) => typeof capabilities[key] !== "boolean")) return null
  return { provider, capabilities: capabilities as ProviderCapabilities }
}

export function useProviderCapabilities(sessionId: string | null | undefined): ProviderCapabilitiesResult {
  const [result, setResult] = React.useState<ProviderCapabilitiesResult>({
    sessionId: sessionId ?? null,
    state: sessionId ? "loading" : "idle",
    provider: null,
    capabilities: null,
    error: null,
  })

  React.useEffect(() => {
    if (!sessionId) {
      setResult({ sessionId: null, state: "idle", provider: null, capabilities: null, error: null })
      return
    }

    const controller = new AbortController()
    setResult({ sessionId, state: "loading", provider: null, capabilities: null, error: null })

    void fetch(`/api/sessions/${encodeURIComponent(sessionId)}/capabilities`, { signal: controller.signal })
      .then(async (response) => {
        const data: unknown = await response.json().catch(() => null)
        if (!response.ok) throw new Error(apiErrorMessage(data, `Could not load capabilities (HTTP ${response.status}).`))
        const parsed = parseCapabilities(data)
        if (!parsed) throw new Error("The session returned an invalid capability set.")
        return parsed
      })
      .then(({ provider, capabilities }) => {
        setResult({ sessionId, state: "ready", provider, capabilities, error: null })
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return
        setResult({
          sessionId,
          state: "error",
          provider: null,
          capabilities: null,
          error: cause instanceof Error ? cause.message : "Could not load provider capabilities.",
        })
      })

    return () => controller.abort()
  }, [sessionId])

  return result
}
