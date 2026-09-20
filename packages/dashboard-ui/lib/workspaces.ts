export const WORKSPACE_COOKIE = "wa_workspace_id"

export interface WorkspaceSummary {
  id: string
  name: string
  role?: string
  waServerConfigured?: boolean
  createdAt?: string
}

export interface WorkspaceListResponse {
  workspaces: WorkspaceSummary[]
  selectedWorkspaceId: string | null
}
