"use client"

import * as React from "react"
import { AlertTriangle, CheckCircle2, Clock3, Loader2, Megaphone, Search, XCircle } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  cancelCampaign,
  createCampaign,
  getCampaign,
  launchCampaign,
  listCampaignContacts,
  listCampaignSessions,
  scheduleCampaign,
  updateCampaign,
} from "@/app/dashboard/campaigns/actions"
import type { Campaign, Contact, Session } from "./types"

function errorText(message: string | undefined): string {
  return message || "The campaign request failed."
}

function dateText(value: string | null): string {
  if (!value) return "—"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function statusTone(status: string): "secondary" | "outline" | "destructive" {
  if (["COMPLETED", "SENT"].includes(status)) return "secondary"
  if (["FAILED", "CANCELLED", "INDETERMINATE"].includes(status)) return "destructive"
  return "outline"
}

function Status({ value }: { value: string }) {
  return <Badge variant={statusTone(value)}>{value.toLowerCase().replace(/_/g, " ")}</Badge>
}

export function CampaignsView({
  initialCampaigns,
  initialContacts,
  initialSessions,
}: {
  initialCampaigns: Campaign[]
  initialContacts: Contact[]
  initialSessions: Session[]
}) {
  const [campaigns, setCampaigns] = React.useState(initialCampaigns)
  const [contacts, setContacts] = React.useState(initialContacts)
  const [sessions, setSessions] = React.useState(initialSessions)
  const [selected, setSelected] = React.useState<Campaign | null>(null)
  const [name, setName] = React.useState("")
  const [message, setMessage] = React.useState("")
  const [sessionId, setSessionId] = React.useState("")
  const [selectedContactIds, setSelectedContactIds] = React.useState<Set<string>>(new Set())
  const [search, setSearch] = React.useState("")
  const [scheduledAt, setScheduledAt] = React.useState("")
  const [loading, setLoading] = React.useState(false)
  const [contactsLoading, setContactsLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const contactsRequestRef = React.useRef(0)

  const connectedSessions = React.useMemo(() => sessions.filter((session) => session.status === "connected"), [sessions])

  React.useEffect(() => {
    const requestId = ++contactsRequestRef.current
    const timer = window.setTimeout(async () => {
      setContactsLoading(true)
      const result = await listCampaignContacts(search)
      if (requestId !== contactsRequestRef.current) return
      if (result.ok && result.data) {
        setContacts(result.data.items ?? [])
      }
      else setError(errorText(result.message))
      setContactsLoading(false)
    }, 250)
    return () => {
      window.clearTimeout(timer)
      if (requestId === contactsRequestRef.current) contactsRequestRef.current += 1
    }
  }, [search])

  const selectCampaign = async (campaign: Campaign) => {
    setError(null)
    setLoading(true)
    const result = await getCampaign(campaign.id)
    setLoading(false)
    if (!result.ok || !result.data) {
      setError(errorText(result.message))
      return
    }
    const detail = result.data
    setSelected(detail)
    setName(detail.name)
    setMessage(detail.message)
    setSessionId(detail.providerSessionId)
    setScheduledAt(detail.scheduledAt ? new Date(detail.scheduledAt).toISOString().slice(0, 16) : "")
    setSelectedContactIds(new Set((detail.recipients ?? []).map((recipient) => recipient.contactId).filter(Boolean) as string[]))
  }

  const toggleContact = (id: string) => {
    setSelectedContactIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const refreshSessions = async () => {
    const result = await listCampaignSessions()
    if (result.ok && result.data) setSessions(result.data)
    else setError(errorText(result.message))
  }

  const save = async () => {
    setError(null)
    if (!name.trim() || !message.trim() || !sessionId || selectedContactIds.size === 0) {
      setError("Enter a campaign name and message, choose a connected session, and select at least one contact.")
      return
    }
    setLoading(true)
    const input = { name, providerSessionId: sessionId, message, contactIds: [...selectedContactIds] }
    const result = selected ? await updateCampaign(selected.id, input) : await createCampaign(input)
    setLoading(false)
    if (!result.ok || !result.data) {
      setError(errorText(result.message))
      return
    }
    const saved = result.data
    setCampaigns((current) => selected ? current.map((campaign) => campaign.id === saved.id ? saved : campaign) : [saved, ...current])
    setSelected(saved)
    setName(saved.name)
    setMessage(saved.message)
    setSessionId(saved.providerSessionId)
    setSelectedContactIds(new Set((saved.recipients ?? []).map((recipient) => recipient.contactId).filter(Boolean) as string[]))
  }

  const schedule = async () => {
    if (!selected || !scheduledAt) return
    const date = new Date(scheduledAt)
    if (Number.isNaN(date.getTime())) {
      setError("Choose a valid schedule time.")
      return
    }
    setError(null)
    setLoading(true)
    const result = await scheduleCampaign(selected.id, date.toISOString())
    setLoading(false)
    if (!result.ok || !result.data) {
      setError(errorText(result.message))
      return
    }
    setSelected(result.data)
    setCampaigns((current) => current.map((campaign) => campaign.id === result.data?.id ? result.data! : campaign))
  }

  const launch = async () => {
    if (!selected || !window.confirm(`Launch this campaign to ${selected.recipientCount} recipient(s)? Sending cannot be automatically undone.`)) return
    setError(null)
    setLoading(true)
    const result = await launchCampaign(selected.id)
    setLoading(false)
    if (!result.ok || !result.data) {
      setError(errorText(result.message))
      return
    }
    setSelected(result.data)
    setCampaigns((current) => current.map((campaign) => campaign.id === result.data?.id ? result.data! : campaign))
  }

  const cancel = async () => {
    if (!selected || !window.confirm("Cancel this campaign?")) return
    setError(null)
    setLoading(true)
    const result = await cancelCampaign(selected.id)
    setLoading(false)
    if (!result.ok || !result.data) {
      setError(errorText(result.message))
      return
    }
    setSelected(result.data)
    setCampaigns((current) => current.map((campaign) => campaign.id === result.data?.id ? result.data! : campaign))
  }

  const editable = !selected || selected.status === "DRAFT"

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Campaigns</h1>
          <p className="text-sm text-muted-foreground">Prepare workspace-scoped WhatsApp sends with durable results.</p>
        </div>
        <Button variant="outline" onClick={() => { setSelected(null); setName(""); setMessage(""); setSessionId(""); setSelectedContactIds(new Set()); setScheduledAt(""); setError(null) }}>
          New draft
        </Button>
      </div>

      {error && <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{error}</div>}
      {loading && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Updating campaign…</p>}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <Card>
          <CardHeader><CardTitle>{selected ? "Campaign draft" : "Create a draft"}</CardTitle><CardDescription>Only selected existing direct contacts are snapshotted.</CardDescription></CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="campaign-name">Campaign name</Label>
              <Input id="campaign-name" value={name} disabled={!editable} maxLength={120} required placeholder="e.g. Spring sale" onChange={(event) => setName(event.target.value)} />
              <span className="text-right text-xs text-muted-foreground">{name.length}/120</span>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="campaign-session">Connected session</Label>
              <select id="campaign-session" value={sessionId} disabled={!editable} onChange={(event) => setSessionId(event.target.value)} className="h-10 rounded-lg border border-input bg-background px-3 text-sm">
                <option value="">Select an exact connected session…</option>
                {connectedSessions.map((session) => <option key={session.id} value={session.id}>{session.id}{session.phoneNumber ? ` · ${session.phoneNumber}` : ""}</option>)}
              </select>
              {connectedSessions.length === 0 && <p className="text-xs text-muted-foreground">No connected session is available.</p>}
              <Button type="button" variant="ghost" size="sm" className="w-fit px-0" onClick={() => void refreshSessions()}>Refresh sessions</Button>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="campaign-message">Message</Label>
              <Textarea id="campaign-message" value={message} disabled={!editable} maxLength={4096} rows={5} placeholder="Write the message to send…" onChange={(event) => setMessage(event.target.value)} />
              <span className="text-right text-xs text-muted-foreground">{message.length}/4096</span>
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2"><Label htmlFor="campaign-contacts">Recipients</Label><span className="text-xs text-muted-foreground">{selectedContactIds.size} selected</span></div>
              <div className="relative"><Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" /><Input id="campaign-contacts" className="pl-8" value={search} disabled={!editable} placeholder="Search contacts…" onChange={(event) => setSearch(event.target.value)} /></div>
              <div className="max-h-64 overflow-auto rounded-lg border" aria-live="polite">
                {contactsLoading ? <p className="p-3 text-sm text-muted-foreground">Searching contacts…</p> : contacts.length === 0 ? <p className="p-3 text-sm text-muted-foreground">No contacts found.</p> : contacts.map((contact) => <label key={contact.id} className="flex cursor-pointer items-center gap-3 border-b p-2.5 last:border-b-0 hover:bg-muted/50"><input type="checkbox" checked={selectedContactIds.has(contact.id)} disabled={!editable} onChange={() => toggleContact(contact.id)} className="size-4 accent-primary" /><span className="min-w-0"><span className="block truncate text-sm font-medium">{contact.name}</span><span className="block truncate text-xs text-muted-foreground">{contact.phone} · {contact.jid}</span></span></label>)}
              </div>
            </div>
            {selected && <div className="flex flex-col gap-1.5"><Label htmlFor="campaign-schedule">Schedule (optional)</Label><Input id="campaign-schedule" type="datetime-local" disabled={!editable} value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} /><span className="text-xs text-muted-foreground">Scheduling persists in the database and is picked up after restart.</span></div>}
            <div className="flex flex-wrap gap-2">
              {editable && <Button onClick={() => void save()} disabled={loading}>{selected ? "Save draft" : "Create draft"}</Button>}
              {selected?.status === "DRAFT" && <Button variant="outline" onClick={() => void schedule()} disabled={loading || !scheduledAt}><Clock3 className="mr-1.5 size-4" />Schedule</Button>}
              {selected && ["DRAFT", "SCHEDULED"].includes(selected.status) && <Button variant="destructive" onClick={() => void cancel()} disabled={loading}><XCircle className="mr-1.5 size-4" />Cancel</Button>}
              {selected && ["DRAFT", "SCHEDULED"].includes(selected.status) && <Button onClick={() => void launch()} disabled={loading || !selected.recipientCount}><Megaphone className="mr-1.5 size-4" />Launch</Button>}
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-6">
          <Card><CardHeader><CardTitle>Campaigns</CardTitle><CardDescription>{campaigns.length} recent campaign{campaigns.length === 1 ? "" : "s"}</CardDescription></CardHeader><CardContent className="p-0"><div className="divide-y">{campaigns.length === 0 ? <p className="p-6 text-sm text-muted-foreground">No campaign drafts yet.</p> : campaigns.map((campaign) => <button key={campaign.id} type="button" onClick={() => void selectCampaign(campaign)} className="flex w-full items-center gap-3 p-4 text-left hover:bg-muted/40"><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{campaign.name}</p><p className="mt-1 truncate text-xs text-muted-foreground">{campaign.message}</p><p className="mt-1 text-xs text-muted-foreground">Session {campaign.providerSessionId} · {campaign.recipientCount} recipient{campaign.recipientCount === 1 ? "" : "s"}</p></div><Status value={campaign.status} /></button>)}</div></CardContent></Card>

          {selected?.recipients && <Card><CardHeader><CardTitle className="flex items-center gap-2"><CheckCircle2 className="size-5" />Recipient results</CardTitle><CardDescription>Snapshots remain visible even if the contact book changes.</CardDescription></CardHeader><CardContent className="p-0"><div className="overflow-x-auto"><table className="w-full text-sm"><caption className="sr-only">Recipient delivery results</caption><thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="px-4 py-3 font-medium">Recipient</th><th className="px-4 py-3 font-medium">Status</th><th className="px-4 py-3 font-medium">Result</th></tr></thead><tbody className="divide-y">{selected.recipients.map((recipient) => <tr key={recipient.id}><td className="px-4 py-3"><span className="block font-medium">{recipient.displayName || recipient.phone}</span><span className="block text-xs text-muted-foreground">{recipient.phone} · {recipient.jid}</span></td><td className="px-4 py-3"><Status value={recipient.status} /></td><td className="px-4 py-3 text-xs text-muted-foreground">{recipient.errorMessage || (recipient.conversationId ? `Conversation ${recipient.conversationId}` : dateText(recipient.completedAt))}</td></tr>)}</tbody></table></div></CardContent></Card>}
        </div>
      </div>
    </div>
  )
}
