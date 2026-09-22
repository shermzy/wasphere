export interface Contact {
  id: string
  name: string
  phone: string
  jid: string
}

export interface Session {
  id: string
  status: string
  name?: string | null
  phoneNumber?: string | null
}

export interface CampaignRecipient {
  id: string
  contactId: string | null
  targetKey: string
  phone: string
  jid: string
  displayName: string | null
  status: string
  claimedAt: string | null
  completedAt: string | null
  conversationId: string | null
  errorMessage: string | null
}

export interface Campaign {
  id: string
  workspaceId: string
  name: string
  providerSessionId: string
  message: string
  createdBy: string
  status: string
  scheduledAt: string | null
  startedAt: string | null
  finishedAt: string | null
  createdAt: string | null
  updatedAt: string | null
  recipientCount: number
  resultCounts?: Record<string, number>
  recipients?: CampaignRecipient[]
}

export interface ActionResult<T> {
  ok: boolean
  status: number
  data?: T | null
  message?: string
}
