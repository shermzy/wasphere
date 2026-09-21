export function workspaceSessionId(workspaceId: string | null | undefined): string {
  return workspaceId ? `workspace-${workspaceId}` : ""
}
