"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import type {
  WorkspaceListResponse,
  WorkspaceSummary,
} from "@/lib/workspaces"

interface WorkspaceContextValue {
  workspaces: WorkspaceSummary[]
  selectedWorkspaceId: string | null
  selectedWorkspace: WorkspaceSummary | null
  loading: boolean
  error: string | null
  reloadWorkspaces: () => Promise<void>
  selectWorkspace: (workspaceId: string) => Promise<void>
  createWorkspace: (name: string) => Promise<WorkspaceSummary>
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    const message = (data as { message?: string } | null)?.message
    throw new Error(message ?? "Workspace request failed")
  }
  return data as T
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([])
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reloadWorkspaces = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch("/api/workspaces", { cache: "no-store" })
      const data = await readJson<WorkspaceListResponse>(response)
      setWorkspaces(data.workspaces)
      setSelectedWorkspaceId(data.selectedWorkspaceId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load workspaces")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reloadWorkspaces()
  }, [reloadWorkspaces])

  const selectWorkspace = useCallback(async (workspaceId: string) => {
    setError(null)
    try {
      const response = await fetch("/api/workspaces/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      })
      await readJson(response)
      setSelectedWorkspaceId(workspaceId)
      window.location.reload()
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not switch workspace"
      setError(message)
      throw new Error(message)
    }
  }, [])

  const createWorkspace = useCallback(async (name: string) => {
    setError(null)
    try {
      const response = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      })
      const data = await readJson<{ workspace: WorkspaceSummary; selectedWorkspaceId: string }>(response)
      setWorkspaces((current) => [data.workspace, ...current.filter((item) => item.id !== data.workspace.id)])
      setSelectedWorkspaceId(data.selectedWorkspaceId)
      window.location.reload()
      return data.workspace
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not create workspace"
      setError(message)
      throw new Error(message)
    }
  }, [])

  const value = useMemo<WorkspaceContextValue>(() => ({
    workspaces,
    selectedWorkspaceId,
    selectedWorkspace: workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? null,
    loading,
    error,
    reloadWorkspaces,
    selectWorkspace,
    createWorkspace,
  }), [
    workspaces,
    selectedWorkspaceId,
    loading,
    error,
    reloadWorkspaces,
    selectWorkspace,
    createWorkspace,
  ])

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext)
  if (!context) throw new Error("useWorkspace must be used within WorkspaceProvider")
  return context
}
