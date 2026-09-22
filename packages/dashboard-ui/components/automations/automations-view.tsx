"use client"

import * as React from "react"
import { AlertTriangle, CheckCircle2, Loader2, Plus, RefreshCw, XCircle } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { createAutomation, listAutomationRuns, setAutomationEnabled, updateAutomation } from "@/app/dashboard/automations/actions"
import type { AutomationRule, AutomationRun, Session } from "@/app/dashboard/automations/types"

function statusVariant(status: string): "secondary" | "outline" | "destructive" {
  if (status === "SENT") return "secondary"
  if (["FAILED", "INDETERMINATE"].includes(status)) return "destructive"
  return "outline"
}

function dateText(value: string | null | undefined): string {
  if (!value) return "—"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

export function AutomationsView({ initialRules, initialSessions }: { initialRules: AutomationRule[]; initialSessions: Session[] }) {
  const [rules, setRules] = React.useState(initialRules)
  const [sessions, setSessions] = React.useState(initialSessions)
  const [selected, setSelected] = React.useState<AutomationRule | null>(null)
  const [name, setName] = React.useState("")
  const [sessionId, setSessionId] = React.useState("")
  const [keyword, setKeyword] = React.useState("")
  const [responseText, setResponseText] = React.useState("")
  const [runs, setRuns] = React.useState<AutomationRun[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const connectedSessions = React.useMemo(() => sessions.filter((session) => session.status === "connected"), [sessions])

  const resetEditor = () => {
    setSelected(null)
    setName("")
    setSessionId("")
    setKeyword("")
    setResponseText("")
    setRuns([])
    setError(null)
  }

  const selectRule = (rule: AutomationRule) => {
    setSelected(rule)
    setName(rule.name)
    setSessionId(rule.providerSessionId)
    setKeyword(rule.keyword)
    setResponseText(rule.responseText)
    setRuns([])
    setError(null)
  }

  const save = async () => {
    if (!name.trim() || !sessionId || !keyword.trim() || !responseText.trim()) {
      setError("Choose a connected session and complete every automation field.")
      return
    }
    setLoading(true)
    setError(null)
    const input = { name, providerSessionId: sessionId, keyword, responseText }
    const result = selected ? await updateAutomation(selected.id, input) : await createAutomation(input)
    setLoading(false)
    if (!result.ok) {
      setError(result.message)
      return
    }
    setRules((current) => selected ? current.map((rule) => rule.id === result.data.id ? result.data : rule) : [result.data, ...current])
    selectRule(result.data)
  }

  const toggle = async () => {
    if (!selected) return
    const action = selected.enabled ? "Disable this automation?" : "Enable this automation? It may reply to future matching inbound messages."
    if (!window.confirm(action)) return
    setLoading(true)
    setError(null)
    const result = await setAutomationEnabled(selected.id, !selected.enabled)
    setLoading(false)
    if (!result.ok) {
      setError(result.message)
      return
    }
    setSelected(result.data)
    setRules((current) => current.map((rule) => rule.id === result.data.id ? result.data : rule))
  }

  const loadRuns = async () => {
    if (!selected) return
    setLoading(true)
    setError(null)
    const result = await listAutomationRuns(selected.id)
    setLoading(false)
    if (!result.ok) setError(result.message)
    else setRuns(result.data)
  }

  const refreshSessions = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch("/api/sessions", { cache: "no-store" })
      const data = await response.json().catch(() => null) as Session[] | { sessions?: Session[] } | { message?: string } | null
      if (!response.ok) throw new Error(data && "message" in data ? String(data.message ?? "Could not load sessions.") : "Could not load sessions.")
      setSessions(Array.isArray(data) ? data : data && "sessions" in data ? data.sessions ?? [] : [])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load sessions.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Automations Pro</h1>
          <p className="text-sm text-muted-foreground">Reply to direct inbound text matches on one exact connected session.</p>
        </div>
        <Button variant="outline" onClick={resetEditor}><Plus className="mr-1.5 size-4" />New rule</Button>
      </div>

      {error && <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{error}</div>}
      {loading && <p role="status" aria-live="polite" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Working…</p>}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
        <Card>
          <CardHeader><CardTitle>{selected ? "Edit rule" : "Create a rule"}</CardTitle><CardDescription>New rules are disabled until explicitly enabled.</CardDescription></CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5"><Label htmlFor="automation-name">Name</Label><Input id="automation-name" value={name} maxLength={120} onChange={(event) => setName(event.target.value)} placeholder="Support greeting" /></div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="automation-session">Exact connected session</Label>
              <select id="automation-session" value={sessionId} onChange={(event) => setSessionId(event.target.value)} className="h-9 rounded-lg border border-input bg-background px-3 text-sm">
                <option value="">Select an exact connected session…</option>
                {connectedSessions.map((session) => <option key={session.id} value={session.id}>{session.id}{session.phoneNumber ? ` · ${session.phoneNumber}` : ""}</option>)}
              </select>
              {connectedSessions.length === 0 && <p className="text-xs text-muted-foreground">No connected workspace session is available.</p>}
              <Button type="button" variant="ghost" size="sm" className="w-fit px-0" onClick={() => void refreshSessions()}><RefreshCw className="mr-1.5 size-3.5" />Refresh sessions</Button>
            </div>
            <div className="flex flex-col gap-1.5"><Label htmlFor="automation-keyword">Inbound text contains</Label><Input id="automation-keyword" value={keyword} maxLength={120} onChange={(event) => setKeyword(event.target.value)} placeholder="hello" /><span className="text-xs text-muted-foreground">Case-insensitive substring match; text messages only.</span></div>
            <div className="flex flex-col gap-1.5"><Label htmlFor="automation-response">Response text</Label><Textarea id="automation-response" value={responseText} maxLength={4096} rows={5} onChange={(event) => setResponseText(event.target.value)} placeholder="Thanks for reaching out." /><span className="text-right text-xs text-muted-foreground">{responseText.length}/4096</span></div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void save()} disabled={loading}>{selected ? "Save changes" : "Create disabled rule"}</Button>
              {selected && <Button variant={selected.enabled ? "destructive" : "outline"} onClick={() => void toggle()} disabled={loading}>{selected.enabled ? <><XCircle className="mr-1.5 size-4" />Disable</> : <><CheckCircle2 className="mr-1.5 size-4" />Enable</>}</Button>}
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-6">
          <Card><CardHeader><CardTitle>Rules</CardTitle><CardDescription>{rules.length} workspace rule{rules.length === 1 ? "" : "s"}</CardDescription></CardHeader><CardContent className="p-0"><div className="divide-y">{rules.length === 0 ? <p className="p-6 text-sm text-muted-foreground">No automation rules yet.</p> : rules.map((rule) => <button key={rule.id} type="button" onClick={() => selectRule(rule)} className="flex w-full items-center gap-3 p-4 text-left hover:bg-muted/40"><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{rule.name}</p><p className="mt-1 truncate text-xs text-muted-foreground">{rule.providerSessionId} · contains “{rule.keyword}”</p>{rule.recentRun && <p className="mt-1 text-xs text-muted-foreground">Last run: {rule.recentRun.status}{rule.recentRun.error ? ` · ${rule.recentRun.error}` : ""}</p>}</div><Badge variant={rule.enabled ? "secondary" : "outline"}>{rule.enabled ? "enabled" : "disabled"}</Badge></button>)}</div></CardContent></Card>

          {selected && <Card><CardHeader><CardTitle>Run history</CardTitle><CardDescription>Runs are claimed before the provider call; unknown outcomes are never retried automatically.</CardDescription></CardHeader><CardContent className="flex flex-col gap-3"><Button variant="outline" className="w-fit" onClick={() => void loadRuns()} disabled={loading}>Load recent runs</Button>{runs.length === 0 ? <p className="text-sm text-muted-foreground">Select “Load recent runs” to inspect this rule.</p> : <div className="overflow-x-auto"><table className="w-full text-sm"><caption className="sr-only">Automation run history</caption><thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="px-2 py-2 font-medium">Status</th><th className="px-2 py-2 font-medium">Inbound message</th><th className="px-2 py-2 font-medium">When</th><th className="px-2 py-2 font-medium">Error</th></tr></thead><tbody className="divide-y">{runs.map((run) => <tr key={run.id}><td className="px-2 py-2"><Badge variant={statusVariant(run.status)}>{run.status.toLowerCase()}</Badge></td><td className="px-2 py-2 font-mono text-xs">{run.providerMessageId}</td><td className="px-2 py-2 text-xs text-muted-foreground">{dateText(run.createdAt)}</td><td className="max-w-64 px-2 py-2 text-xs text-destructive">{run.error || "—"}</td></tr>)}</tbody></table></div>}</CardContent></Card>}
        </div>
      </div>
    </div>
  )
}
