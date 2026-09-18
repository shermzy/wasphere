export type ProjectAvailability = "connected" | "unavailable"

export interface ProjectTarget {
  sessionId: string
  jid: string
  type: "group" | "direct"
  name: string
  conversationId: string | null
  assignedProject: { id: string; name: string; routeKey: string } | null
  availability: ProjectAvailability
}

export interface ProjectRoute {
  id: string
  workspaceId: string
  name: string
  routeKey: string
  createdBy: string
  createdAt: string
  updatedAt: string
  sessionId: string
  target: {
    conversationId: string
    jid: string
    type: "group" | "direct"
    name: string
  }
  availability: ProjectAvailability
}
