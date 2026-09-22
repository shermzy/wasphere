"use client"

import * as React from "react"
import { toast } from "sonner"
import { Bell, BellOff, Inbox as InboxIcon, PanelRight, ArrowLeft, Lock, PenSquare } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { StatusDot } from "@/components/ui/status-dot"
import { cn } from "@/lib/utils"
import { useInboxStream } from "@/lib/use-inbox-stream"
import { apiErrorMessage } from "@/lib/api-error"
import { mergeUniqueById } from "@/lib/pagination"
import { useProviderCapabilities } from "@/lib/use-provider-capabilities"
import { ConversationList } from "./conversation-list"
import { ThreadView } from "./thread-view"
import { Composer } from "./composer"
import { ContactPanel } from "./contact-panel"
import { ForwardDialog } from "./forward-dialog"
import type { Conversation, ConversationStatus, InboxMessage, OutboundReply, Paginated } from "./types"
import type { ProjectRoute } from "@/components/projects/types"

const SOUND_KEY = "wasphere.inbox.soundEnabled"
const MUTED_KEY = "wasphere.inbox.mutedConversations"

type NewChatTemplate = {
  name: string
  language: string
  bodyText: string
  variables: number
}

function beep() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new Ctx()
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.connect(g); g.connect(ctx.destination)
    o.frequency.value = 660; o.type = "sine"
    g.gain.setValueAtTime(0.0001, ctx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.02)
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25)
    o.start(); o.stop(ctx.currentTime + 0.26)
  } catch { /* ignore */ }
}

export function InboxView({ initialConversations, initialNextCursor, initialProjects }: { initialConversations: Conversation[]; initialNextCursor: string | null; initialProjects: ProjectRoute[] }) {
  const [conversations, setConversations] = React.useState<Conversation[]>(initialConversations)
  const [conversationCursor, setConversationCursor] = React.useState<string | null>(initialNextCursor)
  const [conversationLoadingMore, setConversationLoadingMore] = React.useState(false)
  const [conversationError, setConversationError] = React.useState<string | null>(null)
  const [projectRoutes, setProjectRoutes] = React.useState<ProjectRoute[]>(initialProjects)
  const [listLoading, setListLoading] = React.useState(false)
  const [statusTab, setStatusTab] = React.useState<ConversationStatus>("OPEN")
  const [search, setSearch] = React.useState("")
  const [selected, setSelected] = React.useState<Conversation | null>(null)
  const [messages, setMessages] = React.useState<InboxMessage[]>([])
  const [msgLoading, setMsgLoading] = React.useState(false)
  const [sending, setSending] = React.useState(false)
  const [showContact, setShowContact] = React.useState(true)
  const [connected, setConnected] = React.useState(false)
  const [sound, setSound] = React.useState(true)
  const [mutedIds, setMutedIds] = React.useState<Set<string>>(new Set())
  const [sessions, setSessions] = React.useState<string[]>([])
  const [sessionFilter, setSessionFilter] = React.useState<string>("") // "" = all sessions (universal inbox)
  const [mobileContactOpen, setMobileContactOpen] = React.useState(false)
  const [messageCursor, setMessageCursor] = React.useState<string | null>(null)
  const [messageLoadingMore, setMessageLoadingMore] = React.useState(false)
  const [messageError, setMessageError] = React.useState<string | null>(null)

  // New-chat (message a number that hasn't written first)
  const [newChatOpen, setNewChatOpen] = React.useState(false)
  const [ncSession, setNcSession] = React.useState("")
  const [ncPhone, setNcPhone] = React.useState("")
  const [ncText, setNcText] = React.useState("")
  const [ncSending, setNcSending] = React.useState(false)
  const [ncError, setNcError] = React.useState<string | null>(null)
  const [ncTemplates, setNcTemplates] = React.useState<NewChatTemplate[]>([])
  const [ncTemplateLoading, setNcTemplateLoading] = React.useState(false)
  const [ncTemplate, setNcTemplate] = React.useState<NewChatTemplate | null>(null)
  const [ncTemplateParams, setNcTemplateParams] = React.useState<string[]>([])

  const selectedId = selected?.id ?? null
  const selectedProject = selected
    ? projectRoutes.find((project) => project.target.conversationId === selected.id || (project.sessionId === selected.sessionId && project.target.jid === selected.contact.jid)) ?? null
    : null
  const selectedIdRef = React.useRef<string | null>(null)
  selectedIdRef.current = selectedId
  const mutedIdsRef = React.useRef(mutedIds)
  mutedIdsRef.current = mutedIds
  const listRequestRef = React.useRef(0)
  const messageRequestRef = React.useRef(0)
  const selectedSessionId = selected?.sessionId ?? null
  const capabilityResult = useProviderCapabilities(selectedSessionId)
  const capabilitiesForSelection = capabilityResult.sessionId === selectedSessionId ? capabilityResult.capabilities : null
  const capabilityStateForSelection = capabilityResult.sessionId === selectedSessionId ? capabilityResult.state : "loading"
  const capabilityErrorForSelection = capabilityResult.sessionId === selectedSessionId ? capabilityResult.error : null
  const providerForSelection = capabilityResult.sessionId === selectedSessionId ? capabilityResult.provider : null
  const ncCapabilityResult = useProviderCapabilities(ncSession || null)
  const newChatCapabilityState = ncSession ? (ncCapabilityResult.sessionId === ncSession ? ncCapabilityResult.state : "loading") : "idle"
  const newChatProvider = newChatCapabilityState === "ready" ? ncCapabilityResult.provider : null

  React.useEffect(() => {
    setSound(localStorage.getItem(SOUND_KEY) !== "false")
    try {
      const raw = localStorage.getItem(MUTED_KEY)
      if (raw) setMutedIds(new Set(JSON.parse(raw) as string[]))
    } catch { /* ignore */ }
  }, [])

  // Seed the session-filter dropdown from ALL sessions (Baileys + Meta), so it
  // shows every session even before any conversation exists on it.
  React.useEffect(() => {
    let cancelled = false
    fetch("/api/sessions")
      .then((r) => (r.ok ? r.json() : []))
      .then((data: Array<{ id: string }>) => {
        if (cancelled || !Array.isArray(data)) return
        const ids = data.map((s) => s.id).filter(Boolean)
        setSessions((prev) => [...new Set([...prev, ...ids])])
      })
      .catch(() => { /* keep conversation-derived list */ })
    return () => { cancelled = true }
  }, [])

  const toggleMute = (convId: string, muted: boolean) => {
    setMutedIds((prev) => {
      const next = new Set(prev)
      if (muted) next.add(convId)
      else next.delete(convId)
      try { localStorage.setItem(MUTED_KEY, JSON.stringify([...next])) } catch { /* ignore */ }
      return next
    })
  }

  const refreshList = React.useCallback(async (opts?: { silent?: boolean; reset?: boolean }) => {
    const requestId = ++listRequestRef.current
    if (!opts?.silent) setListLoading(true)
    const qs = new URLSearchParams({ status: statusTab, limit: "50" })
    if (search.trim()) qs.set("q", search.trim())
    if (sessionFilter) qs.set("sessionId", sessionFilter)
    try {
      const res = await fetch(`/api/inbox/conversations?${qs}`)
      const data = (await res.json()) as Paginated<Conversation>
      if (!res.ok) throw new Error(apiErrorMessage(data, "Could not load conversations."))
      if (requestId !== listRequestRef.current) return
      setConversations((current) => opts?.reset ? (data.items ?? []) : mergeUniqueById(data.items ?? [], current))
      setConversationCursor(data.nextCursor ?? null)
      setConversationError(null)
      // keep the session-filter dropdown populated from all sessions that have
      // chats (only when viewing the universal inbox, so we never lose options).
      if (!sessionFilter && !search.trim()) {
        setSessions((prev) => {
          const ids = new Set(prev)
          for (const c of data.items ?? []) ids.add(c.sessionId)
          return [...ids]
        })
      }
    } catch (cause) {
      if (requestId === listRequestRef.current) {
        setConversationError(cause instanceof Error ? cause.message : "Could not load conversations. Try again.")
      }
    } finally {
      if (requestId === listRequestRef.current) setListLoading(false)
    }
  }, [statusTab, search, sessionFilter])

  // refetch list when tab or (debounced) search changes
  React.useEffect(() => {
    listRequestRef.current += 1
    setConversationCursor(null)
    setConversationError(null)
    const t = setTimeout(() => { void refreshList({ reset: true }) }, search ? 250 : 0)
    return () => clearTimeout(t)
  }, [refreshList, search])

  const loadMessages = React.useCallback(async (cid: string, opts?: { silent?: boolean }) => {
    const requestId = ++messageRequestRef.current
    if (!opts?.silent) setMsgLoading(true)
    try {
      const res = await fetch(`/api/inbox/conversations/${cid}/messages?limit=50`)
      const data = (await res.json()) as Paginated<InboxMessage>
      if (!res.ok) throw new Error(apiErrorMessage(data, "Could not load messages."))
      if (requestId !== messageRequestRef.current) return
      setMessages(data.items ?? [])
      setMessageCursor(data.nextCursor ?? null)
      setMessageError(null)
    } catch (cause) {
      if (requestId === messageRequestRef.current) setMessageError(cause instanceof Error ? cause.message : "Could not load messages. Try again.")
    } finally {
      if (requestId === messageRequestRef.current) setMsgLoading(false)
    }
  }, [])

  React.useEffect(() => {
    if (!newChatOpen || !ncSession || newChatProvider !== "meta") {
      setNcTemplates([])
      setNcTemplate(null)
      setNcTemplateParams([])
      setNcTemplateLoading(false)
      return
    }

    let cancelled = false
    setNcTemplateLoading(true)
    setNcError(null)
    void fetch(`/api/sessions/${encodeURIComponent(ncSession)}/templates`)
      .then(async (response) => {
        const data: unknown = await response.json().catch(() => null)
        if (!response.ok) throw new Error(apiErrorMessage(data, "Could not load approved templates."))
        return data
      })
      .then((data) => {
        if (cancelled) return
        const list = (Array.isArray(data) ? data : [])
          .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
          .filter((item) => item.status === "APPROVED" && typeof item.name === "string" && typeof item.language === "string")
          .map((item) => ({
            name: item.name as string,
            language: item.language as string,
            bodyText: typeof item.bodyText === "string" ? item.bodyText : "",
            variables: typeof item.variables === "number" && Number.isInteger(item.variables) && item.variables >= 0 ? item.variables : 0,
          }))
        setNcTemplates(list)
      })
      .catch((cause) => {
        if (!cancelled) setNcError(cause instanceof Error ? cause.message : "Could not load approved templates.")
      })
      .finally(() => {
        if (!cancelled) setNcTemplateLoading(false)
      })

    return () => { cancelled = true }
  }, [newChatOpen, ncSession, newChatProvider])

  const loadMoreConversations = async () => {
    if (!conversationCursor || conversationLoadingMore) return
    const requestId = listRequestRef.current
    setConversationLoadingMore(true)
    const qs = new URLSearchParams({ status: statusTab, limit: "50", cursor: conversationCursor })
    if (search.trim()) qs.set("q", search.trim())
    if (sessionFilter) qs.set("sessionId", sessionFilter)
    try {
      const res = await fetch(`/api/inbox/conversations?${qs}`)
      const data = (await res.json()) as Paginated<Conversation>
      if (!res.ok) throw new Error(apiErrorMessage(data, "Could not load more conversations."))
      if (requestId !== listRequestRef.current) return
      setConversations((current) => mergeUniqueById(current, data.items ?? []))
      setConversationCursor(data.nextCursor ?? null)
      setConversationError(null)
    } catch (cause) {
      if (requestId === listRequestRef.current) setConversationError(cause instanceof Error ? cause.message : "Could not load more conversations. Try again.")
    } finally { setConversationLoadingMore(false) }
  }

  const loadMoreMessages = async () => {
    if (!selected || !messageCursor || messageLoadingMore) return
    const cid = selected.id
    const requestId = messageRequestRef.current
    setMessageLoadingMore(true)
    try {
      const qs = new URLSearchParams({ limit: "50", cursor: messageCursor })
      const res = await fetch(`/api/inbox/conversations/${cid}/messages?${qs}`)
      const data = (await res.json()) as Paginated<InboxMessage>
      if (!res.ok) throw new Error(apiErrorMessage(data, "Could not load more messages."))
      if (requestId !== messageRequestRef.current || selectedIdRef.current !== cid) return
      setMessages((current) => mergeUniqueById(current, data.items ?? []))
      setMessageCursor(data.nextCursor ?? null)
      setMessageError(null)
    } catch (cause) {
      if (requestId === messageRequestRef.current) setMessageError(cause instanceof Error ? cause.message : "Could not load more messages. Try again.")
    } finally { setMessageLoadingMore(false) }
  }

  const openConversation = React.useCallback(async (c: Conversation) => {
    setSelected(c)
    setMessages([])
    setMessageCursor(null)
    setMessageError(null)
    void loadMessages(c.id)
    if (c.unreadCount > 0) {
      await fetch(`/api/inbox/conversations/${c.id}/read`, { method: "POST" }).catch(() => null)
      setConversations((prev) => prev.map((x) => (x.id === c.id ? { ...x, unreadCount: 0 } : x)))
    }
  }, [loadMessages])

  // ── realtime ──────────────────────────────────────────────────────────────
  useInboxStream({
    onConnectionChange: setConnected,
    onMessageNew: (ev) => {
      void refreshList({ silent: true })
      const activeId = selectedIdRef.current
      if (ev.conversationId === activeId) {
        void loadMessages(activeId, { silent: true })
      } else if (
        sound &&
        !mutedIdsRef.current.has(ev.conversationId ?? "") &&
        document.visibilityState !== "visible"
      ) {
        beep()
      }
    },
    onConversationUpdate: () => { void refreshList({ silent: true }) },
    onMessageStatus: () => {
      const activeId = selectedIdRef.current
      if (activeId) void loadMessages(activeId, { silent: true })
    },
    onPollFallback: () => { void refreshList({ silent: true }) },
  })

  const sendReply = async (reply: OutboundReply): Promise<boolean> => {
    if (!selected) return false
    const conversationId = selected.id
    setSending(true)
    try {
      const res = await fetch(`/api/inbox/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reply),
      })
      if (!res.ok) {
        const data: unknown = await res.json().catch(() => null)
        toast.error(`${apiErrorMessage(data, res.status === 503 ? "Session disconnected — reconnect to send." : "Could not send reply.")} Try again.`)
        return false
      }
      if (selectedIdRef.current === conversationId) await loadMessages(conversationId, { silent: true })
      void refreshList({ silent: true })
      return true
    } catch {
      toast.error("Could not send reply.")
      return false
    } finally {
      setSending(false)
    }
  }

  const openNewChat = () => {
    setNcSession((s) => s || sessionFilter || sessions[0] || "")
    setNcError(null)
    setNewChatOpen(true)
  }

  // Start a chat with a number tapped from a shared contact card.
  const startChatWith = (phone: string) => {
    setNcSession((s) => s || selectedSessionId || sessions[0] || "")
    setNcPhone(phone.replace(/[^0-9]/g, ""))
    setNcText("")
    setNcError(null)
    setNewChatOpen(true)
  }

  const startNewChat = async () => {
    const sessionId = ncSession || sessions[0]
    const phone = ncPhone.replace(/[^0-9]/g, "")
    const text = ncText.trim()
    setNcError(null)
    if (!sessionId) { toast.error("Pick a session."); return }
    if (phone.length < 6) { toast.error("Enter a valid number with country code."); return }
    if (newChatCapabilityState !== "ready" || !newChatProvider) {
      setNcError("Provider capabilities are unavailable. No message was sent; wait for the selected session capabilities to load, then try again.")
      return
    }

    // Meta starts must remain template sends; never downgrade them to free text.
    const startPayload = newChatProvider === "meta"
      ? {
          sessionId,
          to: phone,
          kind: "template" as const,
          templateName: ncTemplate?.name,
          languageCode: ncTemplate?.language,
          bodyParams: ncTemplateParams.map((param) => param.trim()),
        }
      : { sessionId, to: phone, kind: "text" as const, text }

    if (newChatProvider === "meta") {
      if (!ncTemplate) { setNcError("Select an approved Meta template before continuing. No message was sent."); return }
      if (ncTemplateParams.some((param) => !param.trim())) { setNcError("Fill every template body parameter before continuing. No message was sent."); return }
    }

    if (newChatProvider !== "meta" && !text) { toast.error("Type a message."); return }
    setNcSending(true)
    try {
      const res = await fetch("/api/inbox/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(startPayload),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(Array.isArray(data.message) ? data.message.join("\n") : (data.message ?? "Could not start chat."))
        return
      }
      toast.success("Message sent")
      setNewChatOpen(false); setNcPhone(""); setNcText(""); setNcTemplate(null); setNcTemplateParams([])
      await refreshList({ silent: true })
    } catch {
      toast.error("Could not reach the server.")
    } finally {
      setNcSending(false)
    }
  }

  const [forwardMsg, setForwardMsg] = React.useState<InboxMessage | null>(null)

  const reactToMessage = (m: InboxMessage, emoji: string) => {
    void sendReply({ kind: "reaction", targetMessageId: m.waMessageId, emoji, targetFromMe: m.fromMe })
  }

  const updateNotes = async (notes: string): Promise<boolean> => {
    if (!selected) return false
    const conversationId = selected.id
    try {
      const res = await fetch(`/api/inbox/conversations/${conversationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes }),
      })
      const data: unknown = await res.json().catch(() => null)
      if (!res.ok) throw new Error(apiErrorMessage(data, "Could not save notes."))
      setSelected((s) => (s?.id === conversationId ? { ...s, notes } : s))
      toast.success("Notes saved")
      return true
    } catch (cause) {
      toast.error(`${cause instanceof Error ? cause.message : "Could not save notes."} Try again.`)
      return false
    }
  }

  const updateTags = async (tags: string[]) => {
    if (!selected) return
    const conversationId = selected.id
    try {
      const res = await fetch(`/api/inbox/conversations/${conversationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags }),
      })
      const data: unknown = await res.json().catch(() => null)
      if (!res.ok) throw new Error(apiErrorMessage(data, "Could not save tags."))
      setSelected((s) => (s?.id === conversationId ? { ...s, tags } : s))
      setConversations((prev) => prev.map((c) => (c.id === conversationId ? { ...c, tags } : c)))
      toast.success("Tags saved")
    } catch (cause) {
      toast.error(`${cause instanceof Error ? cause.message : "Could not save tags."} Try again.`)
    }
  }

  const updateProject = async (projectId: string) => {
    if (!selected) return
    if (!projectId) {
      if (!selectedProject) return
      if (!window.confirm(`Delete #${selectedProject.routeKey}? This removes the project route from ${selected.contact.jid}.`)) return
      const response = await fetch(`/api/projects/${selectedProject.id}`, { method: "DELETE" })
      if (!response.ok) { toast.error("Could not remove project."); return }
      setProjectRoutes((current) => current.filter((project) => project.id !== selectedProject.id))
      toast.success("Project removed from chat")
      return
    }
    const route = projectRoutes.find((project) => project.id === projectId)
    if (!route) return
    if (route.id === selectedProject?.id && route.sessionId === selected.sessionId && route.target.jid === selected.contact.jid) return
    if (!window.confirm(`Bind #${route.routeKey} to the exact chat ${selected.contact.jid} in session ${selected.sessionId}?`)) return
    const response = await fetch(`/api/projects/${projectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: selected.sessionId, targetJid: selected.contact.jid, confirmed: true }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      const message = Array.isArray(data.message) ? data.message.join("\n") : (data.message ?? "Could not assign project.")
      toast.error(message)
      return
    }
    setProjectRoutes((current) => current.map((project) => project.id === data.id ? data as ProjectRoute : project))
    toast.success("Project assigned to chat")
  }

  const toggleResolve = async () => {
    if (!selected) return
    const conversationId = selected.id
    const next: ConversationStatus = selected.status === "RESOLVED" ? "OPEN" : "RESOLVED"
    try {
      const res = await fetch(`/api/inbox/conversations/${conversationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      })
      const data: unknown = await res.json().catch(() => null)
      if (!res.ok) throw new Error(apiErrorMessage(data, "Could not update conversation."))
      setSelected((s) => (s?.id === conversationId ? { ...s, status: next } : s))
      setConversations((prev) => prev.map((c) => (c.id === conversationId ? { ...c, status: next } : c)))
      void refreshList({ silent: true, reset: true })
      toast.success(next === "RESOLVED" ? "Marked resolved" : "Reopened")
    } catch (cause) {
      toast.error(`${cause instanceof Error ? cause.message : "Could not update conversation."} Try again.`)
    }
  }

  const toggleSound = () => {
    setSound((s) => {
      const v = !s
      localStorage.setItem(SOUND_KEY, v ? "true" : "false")
      return v
    })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* header bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold text-foreground">Inbox</h1>
           <span role="status" aria-live="polite" className="flex items-center gap-1 text-xs text-muted-foreground">
            <StatusDot status={connected ? "connected" : "connecting"} />
            {connected ? "live" : "polling"}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={openNewChat} title="Message a new number">
            <PenSquare className="size-4" /> New chat
          </Button>
          <Button variant="ghost" size="icon" className="size-8" onClick={toggleSound} title={sound ? "Mute notifications" : "Unmute notifications"} aria-label={sound ? "Mute notifications" : "Unmute notifications"}>
            {sound ? <Bell className="size-4" /> : <BellOff className="size-4" />}
          </Button>
          {selected && (
            <>
              {/* desktop: toggle the inline contact panel */}
               <Button variant="ghost" size="icon" className="hidden size-8 lg:inline-flex" onClick={() => setShowContact((v) => !v)} title="Toggle contact panel" aria-label="Toggle contact panel">
                <PanelRight className="size-4" />
              </Button>
              {/* mobile/tablet: open the contact panel as a slide-in sheet */}
               <Button variant="ghost" size="icon" className="size-8 lg:hidden" onClick={() => setMobileContactOpen(true)} title="Contact info" aria-label="Open contact info">
                <PanelRight className="size-4" />
              </Button>
            </>
          )}
        </div>
      </div>

      {/* panes */}
      <div className="flex min-h-0 flex-1 overflow-hidden rounded-lg border bg-card">
        {/* list — fixed width on desktop; full-width on mobile only when no chat is open */}
        <div className={cn("min-w-0 flex-col border-r md:flex md:w-80 md:shrink-0 md:flex-none", selected ? "hidden md:flex" : "flex flex-1")}>
          <ConversationList
            conversations={conversations}
            selectedId={selectedId}
            onSelect={openConversation}
            search={search}
            onSearch={setSearch}
            statusTab={statusTab}
            onStatusTab={setStatusTab}
            loading={listLoading}
            loadingMore={conversationLoadingMore}
            hasMore={!!conversationCursor}
            error={conversationError}
            onLoadMore={() => void loadMoreConversations()}
            onRetry={() => void refreshList({ reset: true })}
            sessions={sessions}
            sessionFilter={sessionFilter}
            onSessionFilter={setSessionFilter}
          />
        </div>

        {/* thread */}
        <div className={cn("min-w-0 flex-1 flex-col", selected ? "flex" : "hidden md:flex")}>
          {selected ? (
            <ThreadView
              conversation={selected}
              messages={messages}
              loading={msgLoading}
              loadingMore={messageLoadingMore}
              hasMore={!!messageCursor}
              error={messageError}
              onLoadMore={() => void loadMoreMessages()}
              onResolveToggle={toggleResolve}
              onReact={reactToMessage}
              onForward={setForwardMsg}
              onStartChat={startChatWith}
              provider={providerForSelection}
            >
              <>
                <div className="flex items-center gap-1 border-t px-2 py-1 md:hidden">
                  <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
                    <ArrowLeft className="mr-1 size-4" /> Back
                  </Button>
                </div>
                <Composer
                  onSend={sendReply}
                  sending={sending}
                  sessionOffline={!!selected.sessionDeletedAt}
                  capabilities={capabilitiesForSelection}
                  capabilityState={capabilityStateForSelection}
                  capabilityError={capabilityErrorForSelection}
                  sessionId={selected.sessionId}
                />
              </>
            </ThreadView>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-5 bg-muted/20 px-6 text-center">
              <div className="flex size-28 items-center justify-center rounded-full bg-primary/5">
                <InboxIcon className="size-14 text-primary/40" strokeWidth={1.5} />
              </div>
              <div className="max-w-md">
                <h2 className="text-2xl font-semibold text-foreground">WaSphere Inbox</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  Select a conversation to start messaging. Send and receive WhatsApp
                  texts, media, and polls — all from your dashboard, in real time.
                </p>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground/80">
                <Lock className="size-3" />
                End-to-end encrypted by WhatsApp
              </div>
            </div>
          )}
        </div>

        {/* contact panel (desktop) */}
        {selected && showContact && (
          <div className="hidden w-72 shrink-0 border-l lg:flex">
            <ContactPanel
              conversation={selected}
              recent={messages}
              onTagsChange={updateTags}
              project={selectedProject}
              projects={projectRoutes}
              onProjectChange={(projectId) => void updateProject(projectId)}
              onNotesChange={updateNotes}
              muted={mutedIds.has(selected.id)}
              onToggleMute={(v) => toggleMute(selected.id, v)}
            />
          </div>
        )}
      </div>

      <ForwardDialog
        message={forwardMsg}
        conversations={conversations}
        currentId={selectedId}
        onClose={() => setForwardMsg(null)}
      />

      {/* New chat — message a number that hasn't written first */}
      <Dialog open={newChatOpen} onOpenChange={(open) => { setNewChatOpen(open); if (!open) setNcError(null) }}>
        <DialogContent showCloseButton className="sm:max-w-md">
          <DialogHeader><DialogTitle>New chat</DialogTitle></DialogHeader>
          <div className="flex flex-col gap-3">
            {sessions.length > 1 && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="nc-session">Send from</Label>
                <select
                  id="nc-session"
                  value={ncSession}
                  onChange={(e) => setNcSession(e.target.value)}
                  className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                >
                  {sessions.map((s) => (<option key={s} value={s}>{s}</option>))}
                </select>
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="nc-phone">Phone number (with country code)</Label>
              <Input id="nc-phone" value={ncPhone} placeholder="923001234567" onChange={(e) => setNcPhone(e.target.value)} />
            </div>
            {newChatCapabilityState === "loading" && (
              <p role="status" aria-live="polite" className="text-xs text-muted-foreground">Checking provider capabilities…</p>
            )}
            {newChatCapabilityState === "error" && (
              <p role="alert" aria-live="assertive" className="text-xs text-destructive">{ncCapabilityResult.error ?? "Provider capabilities are unavailable."} No message can be sent until this is resolved.</p>
            )}
            {newChatProvider === "baileys" && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="nc-text">Message</Label>
                <Textarea id="nc-text" value={ncText} rows={3} maxLength={4096} placeholder="Type your first message…" onChange={(e) => setNcText(e.target.value)} />
              </div>
            )}
            {newChatProvider === "meta" && (
              <div className="flex flex-col gap-3">
                <p role="status" aria-live="polite" className="text-xs text-muted-foreground">Meta new chats require an approved template. Free-form text is unavailable here.</p>
                <p role="alert" aria-live="assertive" className="text-xs text-destructive">Template new-chat sending is blocked because the current Inbox start endpoint accepts free-form text only. No message will be sent. Next steps: add template handling to POST /api/inbox/conversations with the approved template name, language code, and body parameters, then retry; or open an existing Meta conversation and use Send template.</p>
                {ncTemplateLoading ? (
                  <p role="status" aria-live="polite" className="text-sm text-muted-foreground">Loading approved templates…</p>
                ) : ncTemplate ? (
                  <div className="flex flex-col gap-3">
                    <div className="rounded-md bg-muted/40 px-3 py-2 text-xs">
                      <span className="font-medium">{ncTemplate.name}</span> · {ncTemplate.language}
                      {ncTemplate.bodyText && <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{ncTemplate.bodyText}</p>}
                    </div>
                    {ncTemplateParams.map((value, index) => (
                      <div key={index} className="flex flex-col gap-1.5">
                        <Label htmlFor={`nc-template-${index}`}>Body parameter {`{{${index + 1}}}`}</Label>
                        <Input id={`nc-template-${index}`} value={value} onChange={(e) => setNcTemplateParams((current) => current.map((item, itemIndex) => itemIndex === index ? e.target.value : item))} />
                      </div>
                    ))}
                    <button type="button" onClick={() => { setNcTemplate(null); setNcTemplateParams([]) }} className="self-start text-xs text-primary underline">← Choose another template</button>
                  </div>
                ) : ncTemplates.length ? (
                  <div className="flex flex-col gap-1.5">
                    {ncTemplates.map((template) => (
                      <button type="button" key={`${template.name}-${template.language}`} onClick={() => { setNcTemplate(template); setNcTemplateParams(Array.from({ length: template.variables }, () => "")); setNcError(null) }} className="flex flex-col items-start gap-0.5 rounded-md border border-input px-3 py-2 text-left transition hover:bg-muted/40">
                        <span className="text-sm font-medium">{template.name} <span className="text-xs font-normal text-muted-foreground">· {template.language}</span></span>
                        {template.bodyText && <span className="line-clamp-2 text-xs text-muted-foreground">{template.bodyText}</span>}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p role="alert" aria-live="assertive" className="text-sm text-destructive">No approved templates were found for this Meta session. Create or approve one, then reopen New chat.</p>
                )}
              </div>
            )}
            {ncError && <p role="alert" aria-live="assertive" className="whitespace-pre-line text-xs text-destructive">{ncError}</p>}
          </div>
          <DialogFooter>
            <Button onClick={() => void startNewChat()} disabled={ncSending || newChatCapabilityState !== "ready"}>
              {ncSending ? "Sending…" : newChatCapabilityState !== "ready" ? "Checking capabilities…" : newChatProvider === "meta" ? "Send template" : "Send message"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* mobile/tablet contact panel (slide-in) */}
      <Sheet open={mobileContactOpen} onOpenChange={setMobileContactOpen}>
        <SheetContent side="right" className="w-[88%] max-w-sm gap-0 p-0 lg:hidden">
          <SheetHeader className="border-b p-3">
            <SheetTitle className="text-sm">Contact info</SheetTitle>
          </SheetHeader>
          {selected && (
            <ContactPanel
              conversation={selected}
              recent={messages}
              onTagsChange={updateTags}
              project={selectedProject}
              projects={projectRoutes}
              onProjectChange={(projectId) => void updateProject(projectId)}
              onNotesChange={updateNotes}
              muted={mutedIds.has(selected.id)}
              onToggleMute={(v) => toggleMute(selected.id, v)}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}
