export interface Session {
  id: string
  status?: string
  phoneNumber?: string | null
}

export interface AutomationRun {
  id: string
  automationRuleId: string
  providerSessionId: string
  providerMessageId: string
  status: string
  error: string | null
  history: unknown
  claimedAt: string
  completedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface AutomationRule {
  id: string
  workspaceId: string
  providerSessionId: string
  name: string
  keyword: string
  responseText: string
  enabled: boolean
  createdBy: string
  createdAt: string
  updatedAt: string
  recentRun?: AutomationRun | null
}

export type ActionResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; message: string }
