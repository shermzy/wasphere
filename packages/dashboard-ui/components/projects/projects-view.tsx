"use client"

import * as React from "react"
import Link from "next/link"
import { toast } from "sonner"
import { Check, Clipboard, FolderKanban, Plus, RefreshCw, Search, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import type { ProjectAuditEvent, ProjectRoute, ProjectTarget } from "./types"

type Session = { id: string; status?: string }

const ROUTE_KEY_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/

function errorText(data: unknown, fallback: string): string {
  if (data && typeof data === "object" && "message" in data) {
    const message = (data as { message?: unknown }).message
    return Array.isArray(message) ? message.join("\n") : String(message ?? fallback)
  }
  return fallback
}

function auditRows(data: unknown): ProjectAuditEvent[] {
  if (data && typeof data === "object" && Array.isArray((data as { events?: unknown }).events)) {
    return (data as { events: ProjectAuditEvent[] }).events
  }
  return []
}

function canonicalRouteKey(value: string): string {
  return value.trim().replace(/^#/, "").toLowerCase()
}

function Availability({ value }: { value: ProjectRoute["availability"] }) {
  return value === "connected"
    ? <Badge variant="secondary" className="text-emerald-700 dark:text-emerald-400">Connected</Badge>
    : <Badge variant="destructive">Unavailable</Badge>
}

function ProjectStatus({ enabled }: { enabled: boolean }) {
  return enabled
    ? <Badge variant="secondary" className="text-emerald-700 dark:text-emerald-400">Enabled</Badge>
    : <Badge variant="outline">Disabled</Badge>
}

function auditAction(action: string): string {
  return action.replace(/[._-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function dateText(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

export function ProjectsView({ initialProjects }: { initialProjects: ProjectRoute[] }) {
  const [projects, setProjects] = React.useState(initialProjects)
  const [sessions, setSessions] = React.useState<Session[]>([])
  const [targets, setTargets] = React.useState<ProjectTarget[]>([])
  const [auditEvents, setAuditEvents] = React.useState<ProjectAuditEvent[]>([])
  const [open, setOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<ProjectRoute | null>(null)
  const [name, setName] = React.useState("")
  const [routeKey, setRouteKey] = React.useState("")
  const [sessionId, setSessionId] = React.useState("")
  const [targetSearch, setTargetSearch] = React.useState("")
  const [chatSearch, setChatSearch] = React.useState("")
  const [selectedJid, setSelectedJid] = React.useState("")
  const [targetsLoading, setTargetsLoading] = React.useState(false)
  const [auditLoading, setAuditLoading] = React.useState(false)
  const [syncingSessionId, setSyncingSessionId] = React.useState<string | null>(null)
  const [pendingProjectId, setPendingProjectId] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [targetsError, setTargetsError] = React.useState<string | null>(null)
  const [auditError, setAuditError] = React.useState<string | null>(null)

  const refreshTargets = React.useCallback(async () => {
    setTargetsLoading(true)
    setTargetsError(null)
    try {
      const response = await fetch("/api/project-targets", { cache: "no-store" })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        setTargetsError(errorText(body, "Could not load WhatsApp chats."))
        return false
      }
      setTargets(Array.isArray(body) ? body as ProjectTarget[] : [])
      return true
    } catch {
      setTargetsError("Could not reach the gateway while loading WhatsApp chats.")
      return false
    } finally {
      setTargetsLoading(false)
    }
  }, [])

  const refreshAudit = React.useCallback(async () => {
    setAuditLoading(true)
    setAuditError(null)
    try {
      const response = await fetch("/api/projects/audit?limit=50", { cache: "no-store" })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        setAuditError(errorText(body, "Could not load project audit history."))
        return
      }
      setAuditEvents(auditRows(body))
    } catch {
      setAuditError("Could not reach the gateway while loading project audit history.")
    } finally {
      setAuditLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void refreshTargets()
    void refreshAudit()
  }, [refreshAudit, refreshTargets])

  React.useEffect(() => {
    let cancelled = false
    fetch("/api/sessions", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : [])
      .then((body: Session[] | { sessions?: Session[] }) => {
        if (cancelled) return
        setSessions(Array.isArray(body) ? body : (body.sessions ?? []))
      })
      .catch(() => { if (!cancelled) setSessions([]) })
    return () => { cancelled = true }
  }, [])

  const sessionOptions = React.useMemo(() => {
    const values = [...sessions.map((session) => session.id), ...targets.map((target) => target.sessionId)]
    return [...new Set(values)].map((id) => sessions.find((session) => session.id === id) ?? { id })
  }, [sessions, targets])

  const syncChats = async (id: string) => {
    setSyncingSessionId(id)
    try {
      const response = await fetch("/api/project-targets/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: id }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        toast.error(errorText(body, "Could not sync chats for this session."))
        return
      }
      await refreshTargets()
      toast.success(`Chats synced for session ${id}`)
    } catch {
      toast.error("Could not reach the gateway while syncing chats.")
    } finally {
      setSyncingSessionId(null)
    }
  }

  const beginCreate = () => {
    setEditing(null)
    setName("")
    setRouteKey("")
    setTargetSearch("")
    setSelectedJid("")
    setError(null)
    setSessionId((current) => current || sessionOptions[0]?.id || "")
    setOpen(true)
  }

  const beginCreateForTarget = (target: ProjectTarget) => {
    setEditing(null)
    setName(target.name)
    setRouteKey("")
    setSessionId(target.sessionId)
    setSelectedJid(target.jid)
    setTargetSearch("")
    setError(null)
    setOpen(true)
  }

  const beginEdit = (project: ProjectRoute) => {
    setEditing(project)
    setName(project.name)
    setRouteKey(project.routeKey)
    setSessionId(project.sessionId)
    setSelectedJid(project.target.jid)
    setTargetSearch("")
    setError(null)
    setOpen(true)
  }

  const save = async () => {
    const trimmedName = name.trim()
    const canonical = editing ? editing.routeKey : canonicalRouteKey(routeKey)
    const targetChanged = !!editing && (sessionId !== editing.sessionId || selectedJid !== editing.target.jid)
    const selectedTarget = targets.find((target) => target.sessionId === sessionId && target.jid === selectedJid)

    if (!trimmedName) { setError("Enter a project name."); return }
    if (!editing && !ROUTE_KEY_PATTERN.test(canonical)) {
      setError("Enter a canonical route key using lowercase letters, numbers, and hyphens without leading or trailing hyphens.")
      return
    }
    if (!selectedJid) { setError("Choose an exact WhatsApp chat."); return }
    if ((!editing || targetChanged) && selectedTarget?.availability !== "connected") {
      setError("Select a connected chat before binding or retargeting a project.")
      return
    }
    if ((!editing || targetChanged) && !window.confirm([
      `${editing ? "Retarget" : "Bind"} route #${canonical}?`,
      "",
      `Route key: #${canonical}`,
      `Session ID: ${sessionId}`,
      `Exact JID: ${selectedJid}`,
      "",
      "Continue only if this exact chat is correct.",
    ].join("\n"))) return

    const body = editing
      ? { name: trimmedName, ...(targetChanged ? { sessionId, targetJid: selectedJid, confirmed: true } : {}) }
      : { name: trimmedName, routeKey: canonical, sessionId, targetJid: selectedJid, confirmed: true }

    setSaving(true)
    setError(null)
    try {
      const response = await fetch(editing ? `/api/projects/${editing.id}` : "/api/projects", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) { setError(errorText(data, "Could not save project.")); return }
      const saved = data as ProjectRoute
      setProjects((current) => editing
        ? current.map((project) => project.id === saved.id ? saved : project)
        : [...current, saved])
      setOpen(false)
      await refreshTargets()
      void refreshAudit()
      toast.success(editing ? "Project updated" : "Project created")
    } catch {
      setError("Could not reach the gateway.")
    } finally {
      setSaving(false)
    }
  }

  const toggleEnabled = async (project: ProjectRoute) => {
    const enabled = !project.enabled
    const action = enabled ? "Enable" : "Disable"
    if (!window.confirm(`${action} #${project.routeKey}? ${enabled ? "Agents will be allowed to use this route." : "Agents will no longer be allowed to use this route."}`)) return
    setPendingProjectId(project.id)
    try {
      const response = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) { toast.error(errorText(data, `Could not ${action.toLowerCase()} project.`)); return }
      setProjects((current) => current.map((item) => item.id === project.id ? { ...item, ...(data as ProjectRoute), enabled } : item))
      void refreshTargets()
      void refreshAudit()
      toast.success(`Project ${enabled ? "enabled" : "disabled"}`)
    } catch {
      toast.error("Could not reach the gateway.")
    } finally {
      setPendingProjectId(null)
    }
  }

  const remove = async (project: ProjectRoute) => {
    if (!window.confirm(`Delete ${project.name}? This removes only the project route.`)) return
    const response = await fetch(`/api/projects/${project.id}`, { method: "DELETE" })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) { toast.error(errorText(data, "Could not delete project.")); return }
    setProjects((current) => current.filter((item) => item.id !== project.id))
    void refreshTargets()
    void refreshAudit()
    toast.success("Project route deleted")
  }

  const copyRoute = async (project: ProjectRoute) => {
    try {
      await navigator.clipboard.writeText(`#${project.routeKey}`)
      toast.success("Route key copied")
    } catch {
      toast.error("Could not copy route key")
    }
  }

  const search = chatSearch.trim().toLowerCase()
  const matchingTargets = targets.filter((target) => !search || [
    target.name,
    target.jid,
    target.sessionId,
    target.assignedProject?.name ?? "",
    target.assignedProject?.routeKey ?? "",
  ].some((value) => value.toLowerCase().includes(search)))
  const classified = matchingTargets.filter((target) => !!target.assignedProject)
  const unclassified = matchingTargets.filter((target) => !target.assignedProject)
  const syncSessionIds = [...new Set(sessionOptions.map((session) => session.id))]
  const dialogTargets = targets.filter((target) => target.sessionId === sessionId && (
    !targetSearch.trim() || [target.name, target.jid, target.sessionId].some((value) => value.toLowerCase().includes(targetSearch.trim().toLowerCase()))
  ))

  const renderBucket = (title: string, description: string, rows: ProjectTarget[], classifiedBucket: boolean) => (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title} <span className="text-muted-foreground">({rows.length})</span></CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {targetsLoading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground"><RefreshCw className="size-4 animate-spin" /> Loading chats…</div>
        ) : rows.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">{search ? "No chats match this search." : classifiedBucket ? "No chats are bound to a project route." : "All discovered chats are currently classified."}</p>
        ) : (
          <div className="divide-y rounded-lg border">
            {rows.map((target) => {
              const project = target.assignedProject ? projects.find((item) => item.id === target.assignedProject?.id) : null
              return (
                <div key={`${target.sessionId}:${target.jid}`} className="flex flex-wrap items-center justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-medium">{target.name}</span>
                      <Badge variant="outline">{target.type === "group" ? "Group" : "Direct"}</Badge>
                      {target.availability === "connected" ? <Badge variant="secondary">Connected</Badge> : <Badge variant="destructive">Unavailable</Badge>}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span>Session {target.sessionId}</span>
                      <code className="truncate">{target.jid}</code>
                      {target.assignedProject && <span>#{target.assignedProject.routeKey} · {target.assignedProject.enabled ? "Enabled" : "Disabled"}</span>}
                    </div>
                  </div>
                  {classifiedBucket ? (
                    project ? <Button variant="outline" size="sm" onClick={() => beginEdit(project)}>Edit route</Button> : <span className="text-xs text-muted-foreground">Route not in current list</span>
                  ) : (
                    <Button variant="outline" size="sm" onClick={() => beginCreateForTarget(target)} disabled={target.availability !== "connected"}>Bind route</Button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Projects</h1>
          <p className="mt-1 text-sm text-muted-foreground">Give agents a stable route to one WhatsApp chat.</p>
        </div>
        <Button onClick={beginCreate}><Plus /> New project</Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Chat classification</CardTitle>
          <CardDescription>Search exact chats in this workspace, sync each session, and bind only an explicitly selected target.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-64 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input aria-label="Search classified and unclassified chats" className="pl-9" value={chatSearch} onChange={(event) => setChatSearch(event.target.value)} placeholder="Search chats, sessions, route names, or exact JIDs…" />
            </div>
            <Button variant="outline" onClick={() => void refreshTargets()} disabled={targetsLoading}><RefreshCw className={targetsLoading ? "animate-spin" : ""} /> Refresh</Button>
          </div>
          {syncSessionIds.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 p-3">
              <span className="mr-1 text-sm font-medium">Sync chats:</span>
              {syncSessionIds.map((id) => <Button key={id} variant="secondary" size="sm" onClick={() => void syncChats(id)} disabled={syncingSessionId !== null}><RefreshCw className={syncingSessionId === id ? "animate-spin" : ""} /> {id}</Button>)}
            </div>
          )}
          {targetsError && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{targetsError}</p>}
          <div className="grid gap-4 lg:grid-cols-2">
            {renderBucket("Classified chats", "Chats already bound to a canonical project route.", classified, true)}
            {renderBucket("Unclassified chats", "Discovered chats without a project route.", unclassified, false)}
          </div>
        </CardContent>
      </Card>

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
          {projects.map((project) => {
            const isEnabled = project.enabled
            return (
              <Card key={project.id} size="sm">
                <CardHeader className="flex-row items-start justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle>{project.name}</CardTitle>
                    <CardDescription className="mt-1 flex flex-wrap items-center gap-2">
                      <code className="rounded bg-muted px-1.5 py-0.5 text-xs">#{project.routeKey}</code>
                      <span>Session {project.sessionId}</span>
                      <ProjectStatus enabled={isEnabled} />
                      <Availability value={project.availability} />
                    </CardDescription>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Switch aria-label={`${isEnabled ? "Disable" : "Enable"} ${project.name}`} checked={isEnabled} onCheckedChange={() => void toggleEnabled(project)} disabled={pendingProjectId === project.id} />
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
            )
          })}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Project audit history</CardTitle>
          <CardDescription>Recent route bindings, retargets, renames, and enablement changes for this workspace.</CardDescription>
        </CardHeader>
        <CardContent>
          {auditLoading ? <p className="text-sm text-muted-foreground">Loading audit history…</p> : auditError ? <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{auditError}</p> : auditEvents.length === 0 ? <p className="text-sm text-muted-foreground">No project audit events yet.</p> : (
            <div className="divide-y rounded-lg border">
              {auditEvents.map((event) => (
                <div key={event.id} className="grid gap-1 p-3 text-sm sm:grid-cols-[auto_1fr_auto] sm:items-start sm:gap-x-4">
                  <span className="font-medium">{auditAction(event.action)}</span>
                  <div className="min-w-0 text-muted-foreground"><span className="mr-3">#{event.routeKey}</span><span className="mr-3">Session {event.sessionId}</span><code className="break-all">{event.targetJid}</code></div>
                  <div className="text-xs text-muted-foreground sm:text-right"><div>{dateText(event.createdAt)}</div><div>Actor {event.actorUserId}</div></div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">Generic Inbox tags remain separate. Agents use the route key in the messages API.</p>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent showCloseButton className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader><DialogTitle>{editing ? "Edit project" : "Create project"}</DialogTitle></DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="project-name">Display name</Label>
              <Input id="project-name" value={name} maxLength={100} onChange={(event) => setName(event.target.value)} placeholder="Project A" />
              <p className="text-xs text-muted-foreground">Renaming does not change the canonical route key.</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="project-route-key">Canonical route key</Label>
              <Input id="project-route-key" value={routeKey} maxLength={40} disabled={!!editing} onChange={(event) => setRouteKey(event.target.value)} placeholder="project-a" />
              <p className="text-xs text-muted-foreground">Use lowercase letters, numbers, and hyphens without leading or trailing hyphens. This key stays stable after creation.</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="project-session">WhatsApp session</Label>
              <select id="project-session" value={sessionId} onChange={(event) => { setSessionId(event.target.value); setSelectedJid("") }} className="h-9 rounded-lg border border-input bg-background px-3 text-sm">
                <option value="">Select a session</option>
                {sessionOptions.map((session) => <option key={session.id} value={session.id}>{session.id}{session.status ? ` (${session.status})` : ""}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="project-target-search">Target chat</Label>
              <Input id="project-target-search" value={targetSearch} onChange={(event) => setTargetSearch(event.target.value)} placeholder="Search groups, names, phone numbers, or JIDs…" />
              <div className="max-h-64 overflow-y-auto rounded-lg border">
                {targetsLoading ? (
                  <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><RefreshCw className="size-4 animate-spin" /> Loading WhatsApp chats…</div>
                ) : !sessionId ? (
                  <p className="p-4 text-sm text-muted-foreground">Select a session to choose an exact chat.</p>
                ) : dialogTargets.length === 0 ? (
                  <p className="p-4 text-sm text-muted-foreground">No available chats found for this session.</p>
                ) : dialogTargets.map((target) => {
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
