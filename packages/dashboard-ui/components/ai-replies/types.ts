export interface AiReplySource {
  conversationId: string
  sessionId: string
  contactId: string
  contactJid: string
  contactName: string | null
}

export interface AiReplyDraft {
  draft: string
  source: AiReplySource
}

export interface AiReplyStatus {
  configured: boolean
  message: string
}

export interface AiReplyActionResult<T> {
  ok: boolean
  status: number
  data?: T
  message?: string
}
