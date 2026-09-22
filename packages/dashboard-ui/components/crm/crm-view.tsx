"use client"

import * as React from "react"
import { Inbox, Loader2, RefreshCw, Search, Users } from "lucide-react"
import { useWorkspace } from "@/components/workspaces/workspace-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { apiErrorMessage } from "@/lib/api-error"
import { mergeUniqueById } from "@/lib/pagination"
import { CRM_STAGES, nonCrmTags, parseCrmStage, replaceCrmStage, type CrmStage } from "./crm-tags"

type Contact = {
  id: string
  name: string
  savedName: string | null
  whatsappName: string | null
  phone: string
  tags: string[]
  notes: string | null
}

type ContactsPage = { items?: Contact[]; nextCursor?: string | null }

function contactName(contact: Contact): string {
  return contact.savedName || contact.whatsappName || contact.phone
}

function inboxHref(contact: Contact): string {
  return `/dashboard/inbox?search=${encodeURIComponent(contact.phone)}`
}

export function CrmView() {
  const { selectedWorkspaceId, loading: workspaceLoading } = useWorkspace()
  const [contacts, setContacts] = React.useState<Contact[]>([])
  const [search, setSearch] = React.useState("")
  const [cursor, setCursor] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [loadingMore, setLoadingMore] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [stageErrors, setStageErrors] = React.useState<Record<string, string>>({})
  const [savingId, setSavingId] = React.useState<string | null>(null)
  const requestRef = React.useRef(0)

  const load = React.useCallback(async (query: string, nextCursor: string | null = null) => {
    const requestId = ++requestRef.current
    const append = nextCursor !== null
    if (append) setLoadingMore(true)
    else setLoading(true)

    try {
      const params = new URLSearchParams({ limit: "100" })
      if (query.trim()) params.set("search", query.trim())
      if (nextCursor) params.set("cursor", nextCursor)
      const response = await fetch(`/api/contacts?${params.toString()}`, { cache: "no-store" })
      const data = (await response.json().catch(() => null)) as ContactsPage | null
      if (!response.ok) throw new Error(apiErrorMessage(data, "Could not load CRM contacts."))
      if (requestId !== requestRef.current) return
      const items = Array.isArray(data?.items) ? data.items : []
      setContacts((current) => append ? mergeUniqueById(current, items) : items)
      setCursor(data?.nextCursor ?? null)
      setError(null)
    } catch (cause) {
      if (requestId === requestRef.current) setError(cause instanceof Error ? cause.message : "Could not load CRM contacts.")
    } finally {
      if (requestId === requestRef.current) {
        setLoading(false)
        setLoadingMore(false)
      }
    }
  }, [])

  React.useEffect(() => {
    requestRef.current += 1
    setContacts([])
    setCursor(null)
    setError(null)
    if (workspaceLoading || !selectedWorkspaceId) {
      setLoading(true)
      return
    }
    const timeout = window.setTimeout(() => void load(search), search.trim() ? 250 : 0)
    return () => window.clearTimeout(timeout)
  }, [load, search, selectedWorkspaceId, workspaceLoading])

  const refresh = () => {
    requestRef.current += 1
    setContacts([])
    setCursor(null)
    setError(null)
    void load(search)
  }

  const changeStage = async (contact: Contact, stage: CrmStage) => {
    const tags = replaceCrmStage(contact.tags, stage)
    setSavingId(contact.id)
    setStageErrors((current) => {
      const next = { ...current }
      delete next[contact.id]
      return next
    })
    try {
      const response = await fetch(`/api/contacts/${contact.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags }),
      })
      const data = (await response.json().catch(() => null)) as Contact | { message?: unknown } | null
      if (!response.ok) throw new Error(apiErrorMessage(data, "Could not update CRM stage."))
      const updated = data && "id" in data && typeof data.id === "string" ? data : { ...contact, tags }
      setContacts((current) => current.map((item) => item.id === contact.id ? updated : item))
    } catch (cause) {
      setStageErrors((current) => ({
        ...current,
        [contact.id]: cause instanceof Error ? cause.message : "Could not update CRM stage.",
      }))
    } finally {
      setSavingId((current) => current === contact.id ? null : current)
    }
  }

  const counts = React.useMemo(() => {
    const result = Object.fromEntries(CRM_STAGES.map((stage) => [stage, 0])) as Record<CrmStage, number>
    for (const contact of contacts) result[parseCrmStage(contact.tags) ?? "Lead"] += 1
    return result
  }, [contacts])

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">CRM</h1>
          <p className="mt-1 text-sm text-muted-foreground">Manage contact stages from the workspace contact book.</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={refresh} disabled={loading || loadingMore}>
          <RefreshCw className={loading || loadingMore ? "size-4 animate-spin" : "size-4"} />
          Refresh
        </Button>
      </div>

      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" aria-hidden="true" />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search name or phone…"
          aria-label="Search CRM contacts"
          className="pl-8"
        />
      </div>

      <div className="flex flex-wrap gap-2" aria-label="CRM contact counts">
        <Badge variant="outline"><Users className="size-3" /> {contacts.length} loaded</Badge>
        {CRM_STAGES.map((stage) => <Badge key={stage} variant="secondary">{stage}: {counts[stage]}</Badge>)}
      </div>

      {error && <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error} <button type="button" className="font-medium underline" onClick={refresh}>Try again</button></div>}

      {loading ? (
        <div role="status" aria-live="polite" className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading contacts…</div>
      ) : contacts.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border bg-card py-16 text-center">
          <Inbox className="size-10 text-muted-foreground/50" aria-hidden="true" />
          <div><p className="font-medium">No contacts found</p><p className="mt-1 text-sm text-muted-foreground">Try a different name or phone search.</p></div>
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-4">
          {CRM_STAGES.map((stage) => (
            <section key={stage} aria-labelledby={`crm-stage-${stage}`} className="min-w-0 rounded-xl border bg-muted/20 p-3">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 id={`crm-stage-${stage}`} className="font-medium">{stage}</h2>
                <span className="rounded-full bg-background px-2 py-0.5 text-xs text-muted-foreground">{counts[stage]}</span>
              </div>
              <div className="flex flex-col gap-3">
                {contacts.filter((contact) => (parseCrmStage(contact.tags) ?? "Lead") === stage).map((contact) => {
                  const name = contactName(contact)
                  const currentStage = parseCrmStage(contact.tags) ?? "Lead"
                  const tags = nonCrmTags(contact.tags)
                  return (
                    <Card key={contact.id} size="sm">
                      <CardHeader className="gap-0.5">
                        <CardTitle className="truncate" title={name}>{name}</CardTitle>
                        {contact.savedName && contact.whatsappName && contact.savedName !== contact.whatsappName && <p className="truncate text-xs text-muted-foreground" title={contact.whatsappName}>WhatsApp: {contact.whatsappName}</p>}
                        <p className="text-xs tabular-nums text-muted-foreground">{contact.phone}</p>
                      </CardHeader>
                      <CardContent className="flex flex-col gap-3">
                        {tags.length > 0 && <div className="flex flex-wrap gap-1" aria-label="Contact tags">{tags.map((tag) => <Badge key={tag} variant="outline" className="text-[10px]">{tag}</Badge>)}</div>}
                        <p className="min-h-8 line-clamp-2 text-xs text-muted-foreground">{contact.notes?.trim() || "No notes"}</p>
                        <label className="flex flex-col gap-1 text-xs font-medium">
                          <span>Stage</span>
                          <select
                            value={currentStage}
                            onChange={(event) => void changeStage(contact, event.target.value as CrmStage)}
                            disabled={savingId === contact.id}
                            aria-label={`Stage for ${name}`}
                            className="h-8 rounded-lg border border-input bg-background px-2 text-sm font-normal outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60"
                          >
                            {CRM_STAGES.map((option) => <option key={option} value={option}>{option}</option>)}
                          </select>
                        </label>
                        {stageErrors[contact.id] && <p role="alert" aria-live="assertive" className="text-xs text-destructive">{stageErrors[contact.id]} Stage was not changed.</p>}
                        <a href={inboxHref(contact)} className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium transition-colors hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50">
                          <Inbox className="size-3.5" aria-hidden="true" /> Open Inbox
                        </a>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      {cursor && !loading && (
        <Button type="button" variant="outline" className="self-center" onClick={() => void load(search, cursor)} disabled={loadingMore}>
          {loadingMore && <Loader2 className="size-4 animate-spin" />}
          {loadingMore ? "Loading more…" : "Load more contacts"}
        </Button>
      )}
    </div>
  )
}
