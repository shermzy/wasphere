"use client"

import * as React from "react"
import Link from "next/link"
import { toast } from "sonner"
import { Check, Clipboard, FolderKanban, Plus, RefreshCw, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { ProjectRoute, ProjectTarget } from "./types"

type Session = { id: string; status?: string }

function errorText(data: unknown, fallback: string): string {
  if (data && typeof data === "object" && "message" in data) {
    const message = (data as { message?: unknown }).message
    return Array.isArray(message) ? message.join("\n") : String(message ?? fallback)
  }
  return fallback
}

function Availability({ value }: { value: ProjectRoute["availability"] }) {
  return value === "connected"
    ? <Badge variant="secondary" className="text-emerald-700 dark:text-emerald-400">Connected</Badge>
    : <Badge variant="destructive">Unavailable</Badge>
}

export function ProjectsView({ initialProjects }: { initialProjects: ProjectRoute[] }) {
  const [projects, setProjects] = React.useState(initialProjects)
  const [sessions, setSessions] = React.useState<Session[]>([])
  const [open, setOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<ProjectRoute | null>(null)
  const [name, setName] = React.useState("")
  const [sessionId, setSessionId] = React.useState("")
  const [targetSearch, setTargetSearch] = React.useState("")
  const [selectedJid, setSelectedJid] = React.useState("")
  const [targets, setTargets] = React.useState<ProjectTarget[]>([])
  const [targetsLoading, setTargetsLoading] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    fetch("/api/sessions")
      .then((response) => response.ok ? response.json() : [])
      .then((body: Session[] | { sessions?: Session[] }) => {
        const rows = Array.isArray(body) ? body : (body.sessions ?? [])
        setSessions(rows)
        if (!sessionId && rows[0]?.id) setSessionId(rows[0].id)
      })
      .catch(() => setSessions([]))
  }, [sessionId])

  React.useEffect(() => {
    if (!open || !sessionId) {
      setTargets([])
      return
    }
    let cancelled = false
    setTargetsLoading(true)
    const qs = new URLSearchParams({ sessionId })
    if (targetSearch.trim()) qs.set("q", targetSearch.trim())
    fetch(`/api/project-targets?${qs}`)
      .then(async (response) => ({ ok: response.ok, body: await response.json() }))
      .then(({ ok, body }) => {
        if (cancelled) return
        if (!ok) { setError(errorText(body, "Could not load WhatsApp targets.")); return }
        setTargets(Array.isArray(body) ? body : [])
      })
      .catch(() => { if (!cancelled) setError("Could not load WhatsApp targets.") })
      .finally(() => { if (!cancelled) setTargetsLoading(false) })
    return () => { cancelled = true }
  }, [open, sessionId, targetSearch])

  const beginCreate = () => {
    setEditing(null); setName(""); setTargetSearch(""); setSelectedJid(""); setError(null)
    setSessionId((current) => current || sessions[0]?.id || "")
    setOpen(true)
  }

  const beginEdit = (project: ProjectRoute) => {
    setEditing(project); setName(project.name); setSessionId(project.sessionId)
    setSelectedJid(project.target.jid); setTargetSearch(""); setError(null); setOpen(true)
  }

  const save = async () => {
    if (!name.trim()) { setError("Enter a project name."); return }
    if (!editing && !selectedJid) { setError("Choose a WhatsApp chat."); return }
    const targetChanged = !!editing && (sessionId !== editing.sessionId || selectedJid !== editing.target.jid)
    const body = editing
      ? { name: name.trim(), ...(targetChanged ? { sessionId, targetJid: selectedJid } : {}) }
      : { name: name.trim(), sessionId, targetJid: selectedJid }
    setSaving(true); setError(null)
    try {
      const response = await fetch(editing ? `/api/projects/${editing.id}` : "/api/projects", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) { setError(errorText(data, "Could not save project.")); return }
      setProjects((current) => editing
        ? current.map((project) => project.id === data.id ? data as ProjectRoute : project)
        : [...current, data as ProjectRoute])
      setOpen(false)
      toast.success(editing ? "Project updated" : "Project created")
    } catch {
      setError("Could not reach the gateway.")
    } finally { setSaving(false) }
  }

  const remove = async (project: ProjectRoute) => {
    if (!window.confirm(`Delete ${project.name}? This removes only the project route.`)) return
    const response = await fetch(`/api/projects/${project.id}`, { method: "DELETE" })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) { toast.error(errorText(data, "Could not delete project.")); return }
    setProjects((current) => current.filter((item) => item.id !== project.id))
    toast.success("Project route deleted")
  }

  const copyRoute = async (project: ProjectRoute) => {
    await navigator.clipboard.writeText(`#${project.routeKey}`)
    toast.success("Route key copied")
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Projects</h1>
          <p className="mt-1 text-sm text-muted-foreground">Give agents a stable route to one WhatsApp chat.</p>
        </div>
        <Button onClick={beginCreate}><Plus /> New project</Button>
      </div>

      {projects.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <FolderKanban className="size-10 text-primary/50" />
            <div><p className="font-medium">No project routes yet</p><p className="mt-1 text-sm text-muted-foreground">Create one from a live group or an observed direct chat.</p></div>
            <Button variant="outline" onClick={beginCreate}>Create your first project</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {projects.map((project) => (
            <Card key={project.id} size="sm">
              <CardHeader className="flex-row items-start justify-between gap-3">
                <div className="min-w-0">
                  <CardTitle>{project.name}</CardTitle>
                  <CardDescription className="mt-1 flex flex-wrap items-center gap-2">
                    <code className="rounded bg-muted px-1.5 py-0.5 text-xs">#{project.routeKey}</code>
                    <span>Session {project.sessionId}</span>
                    <Availability value={project.availability} />
                  </CardDescription>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button variant="ghost" size="icon-sm" onClick={() => void copyRoute(project)} title="Copy route key"><Clipboard /></Button>
                  <Button variant="outline" size="sm" onClick={() => beginEdit(project)}>Edit</Button>
                  <Button variant="ghost" size="icon-sm" onClick={() => void remove(project)} title="Delete project"><Trash2 /></Button>
                </div>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="text-muted-foreground">{project.target.type === "group" ? "Group" : "Chat"}:</span>
                  <span className="truncate font-medium">{project.target.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{project.target.jid}</span>
                </div>
                {project.availability === "unavailable" && <span className="text-xs text-destructive">Reconnect or reassign this session to send.</span>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">Generic Inbox tags remain separate. Agents use the route key in the messages API.</p>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent showCloseButton className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader><DialogTitle>{editing ? "Edit project" : "Create project"}</DialogTitle></DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="project-name">Display name</Label>
              <Input id="project-name" value={name} maxLength={100} onChange={(event) => setName(event.target.value)} placeholder="Project A" />
              <p className="text-xs text-muted-foreground">The route key is generated once and stays stable after renaming.</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="project-session">WhatsApp session</Label>
              <select id="project-session" value={sessionId} onChange={(event) => { setSessionId(event.target.value); setSelectedJid("") }} className="h-9 rounded-lg border border-input bg-background px-3 text-sm">
                <option value="">Select a session</option>
                {sessions.map((session) => <option key={session.id} value={session.id}>{session.id}{session.status ? ` (${session.status})` : ""}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="project-target-search">Target chat</Label>
              <Input id="project-target-search" value={targetSearch} onChange={(event) => setTargetSearch(event.target.value)} placeholder="Search groups, names, phone numbers, or JIDs…" />
              <div className="max-h-64 overflow-y-auto rounded-lg border">
                {targetsLoading ? (
                  <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><RefreshCw className="size-4 animate-spin" /> Loading WhatsApp targets…</div>
                ) : targets.length === 0 ? (
                  <p className="p-4 text-sm text-muted-foreground">No available target chats found for this session.</p>
                ) : targets.map((target) => {
                  const assignedElsewhere = !!target.assignedProject && target.assignedProject.id !== editing?.id
                  const selected = selectedJid === target.jid
                  return (
                    <button key={`${target.sessionId}:${target.jid}`} type="button" disabled={assignedElsewhere || target.availability !== "connected"} onClick={() => setSelectedJid(target.jid)} className="flex w-full items-center gap-3 border-b p-3 text-left last:border-b-0 hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50" aria-pressed={selected}>
                      <span className={`flex size-5 shrink-0 items-center justify-center rounded-full border ${selected ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40"}`}>{selected && <Check className="size-3" />}</span>
                      <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{target.name}</span><span className="block truncate text-xs text-muted-foreground">{target.type} · {target.jid}</span></span>
                      {assignedElsewhere && <span className="text-[10px] text-destructive">Assigned</span>}
                    </button>
                  )
                })}
              </div>
            </div>
            {error && <p role="alert" className="whitespace-pre-line rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => void save()} disabled={saving || !sessionId}>{saving ? "Saving…" : editing ? "Save changes" : "Create project"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <p className="text-xs text-muted-foreground">Need to manage the underlying chat? <Link className="text-primary underline-offset-4 hover:underline" href="/dashboard/inbox">Open Inbox</Link>.</p>
    </div>
  )
}
