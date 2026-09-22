"use client"

import * as React from "react"
import Link from "next/link"
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  RefreshCw,
  ShieldCheck,
} from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { useWorkspace } from "@/components/workspaces/workspace-provider"
import {
  generateWhmcsPhp,
  getDefaultWhmcsEvents,
  WHMCS_EVENT_DEFINITIONS,
  type WhmcsEventKey,
  type WhmcsEventsConfig,
} from "./whmcs-code"

interface Session {
  id: string
  status: string
  name?: string | null
  phoneNumber?: string | null
}

const PLACEHOLDERS = "{client_name}, {first_name}, {invoice_id}, {order_id}, {service_id}, {ticket_id}, {amount}, {due_date}"

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash &&
      Boolean(url.hostname) &&
      !url.username &&
      !url.password
    )
  } catch {
    return false
  }
}

function normalizeUrl(value: string): string {
  return value.trim().replace(/\/+$/, "")
}

export function WhmcsGenerator() {
  const { selectedWorkspaceId, selectedWorkspace, loading: workspaceLoading } = useWorkspace()
  const [sessions, setSessions] = React.useState<Session[]>([])
  const [sessionsLoading, setSessionsLoading] = React.useState(false)
  const [sessionsError, setSessionsError] = React.useState<string | null>(null)
  const [selectedSessionId, setSelectedSessionId] = React.useState("")
  const [apiUrl, setApiUrl] = React.useState("")
  const [optInField, setOptInField] = React.useState("WhatsApp Opt-In")
  const [optInValues, setOptInValues] = React.useState("yes,1,on,true,opted-in")
  const [events, setEvents] = React.useState<WhmcsEventsConfig>(() => getDefaultWhmcsEvents())
  const [validationError, setValidationError] = React.useState<string | null>(null)
  const [generatedCode, setGeneratedCode] = React.useState<string | null>(null)
  const [copied, setCopied] = React.useState(false)

  const connectedSessions = React.useMemo(
    () => sessions.filter((session) => session.status === "connected"),
    [sessions],
  )

  const loadSessions = React.useCallback(async () => {
    if (!selectedWorkspaceId) {
      setSessions([])
      setSelectedSessionId("")
      return
    }

    setSessionsLoading(true)
    setSessionsError(null)
    try {
      const response = await fetch("/api/sessions", { cache: "no-store" })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(data?.message ?? "Could not load sessions.")
      }

      const list = Array.isArray(data) ? data : data?.sessions
      setSessions(Array.isArray(list) ? list : [])
      setSelectedSessionId((current) =>
        Array.isArray(list) && list.some((session: Session) => session.id === current && session.status === "connected")
          ? current
          : "",
      )
    } catch (cause) {
      setSessions([])
      setSelectedSessionId("")
      setSessionsError(cause instanceof Error ? cause.message : "Could not load sessions.")
    } finally {
      setSessionsLoading(false)
    }
  }, [selectedWorkspaceId])

  React.useEffect(() => {
    void loadSessions()
  }, [loadSessions])

  const updateEvent = (key: WhmcsEventKey, update: Partial<WhmcsEventsConfig[WhmcsEventKey]>) => {
    setEvents((current) => ({
      ...current,
      [key]: { ...current[key], ...update },
    }))
    setGeneratedCode(null)
    setValidationError(null)
  }

  const validate = (): string | null => {
    if (!selectedWorkspaceId) return "Select a workspace before generating an integration."
    if (!selectedSessionId || !connectedSessions.some((session) => session.id === selectedSessionId)) {
      return "Select a connected WhatsApp session before generating an integration."
    }
    if (!isHttpUrl(apiUrl)) return "Enter a valid public Dashboard API URL using http:// or https://."
    if (!optInField.trim()) return "Enter the WHMCS client custom field name used for WhatsApp opt-in."
    const acceptedValues = optInValues.split(",").map((value) => value.trim()).filter(Boolean)
    if (acceptedValues.length === 0) return "Enter at least one accepted opt-in value."
    const enabledEvents = WHMCS_EVENT_DEFINITIONS.filter((definition) => events[definition.key].enabled)
    if (enabledEvents.length === 0) return "Enable at least one WHMCS event."
    const emptyEvent = enabledEvents.find((definition) => !events[definition.key].template.trim())
    if (emptyEvent) return `Add a message template for ${emptyEvent.label}.`
    return null
  }

  const handleGenerate = () => {
    const error = validate()
    if (error) {
      setValidationError(error)
      setGeneratedCode(null)
      return
    }

    setValidationError(null)
    setGeneratedCode(generateWhmcsPhp({
      apiUrl: normalizeUrl(apiUrl),
      workspaceId: selectedWorkspaceId!,
      sessionId: selectedSessionId,
      optInField: optInField.trim(),
      optInValues: optInValues.split(",").map((value) => value.trim()).filter(Boolean),
      events,
    }))
  }

  const handleCopy = async () => {
    if (!generatedCode) return
    try {
      await navigator.clipboard.writeText(generatedCode)
      setCopied(true)
      toast.success("WHMCS integration copied.")
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error("Could not copy the integration.")
    }
  }

  const handleDownload = () => {
    if (!generatedCode) return
    const blob = new Blob([generatedCode], { type: "application/x-php;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = "wasphere_notifications.php"
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    toast.success("PHP integration downloaded.")
  }

  const sessionReady = Boolean(selectedSessionId && connectedSessions.some((session) => session.id === selectedSessionId))

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">WHMCS integration</h1>
          <Badge variant="secondary" className="gap-1 bg-primary/10 text-primary">
            <ShieldCheck className="size-3.5" /> guarded generator
          </Badge>
        </div>
        <p className="max-w-3xl text-sm text-zinc-700 dark:text-zinc-300">
          Generate a fail-closed WHMCS hook file for opted-in client notifications. Nothing is sent from this page and no WHMCS connection is made.
        </p>
      </div>

      <Card className="border-primary/25 bg-primary/[0.03]">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <CheckCircle2 className="size-4 text-primary" />
            Active workspace binding
          </CardTitle>
          <CardDescription>
            The generated file is locked to the active workspace and one explicitly selected connected session.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="whmcs-workspace">Workspace</Label>
            <Input
              id="whmcs-workspace"
              value={workspaceLoading ? "Loading workspace…" : selectedWorkspace ? `${selectedWorkspace.name} · ${selectedWorkspaceId ?? ""}` : "No active workspace"}
              readOnly
              aria-describedby="whmcs-workspace-help"
              className="font-mono text-xs"
            />
            <p id="whmcs-workspace-help" className="text-xs text-muted-foreground">Switch workspaces from the sidebar to change this binding.</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="whmcs-session">Connected WhatsApp session</Label>
            <select
              id="whmcs-session"
              value={selectedSessionId}
              onChange={(event) => {
                setSelectedSessionId(event.target.value)
                setGeneratedCode(null)
                setValidationError(null)
              }}
              disabled={sessionsLoading || connectedSessions.length === 0}
              className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30"
              aria-describedby="whmcs-session-help"
            >
              <option value="">Select a connected session…</option>
              {connectedSessions.map((session) => (
                <option key={session.id} value={session.id}>
                  {session.name ? `${session.name} · ` : ""}{session.id}{session.phoneNumber ? ` · ${session.phoneNumber}` : ""}
                </option>
              ))}
            </select>
            <p id="whmcs-session-help" className="text-xs text-muted-foreground">
              {sessionsLoading ? "Loading sessions…" : `${connectedSessions.length} connected session${connectedSessions.length === 1 ? "" : "s"} available.`}
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => void loadSessions()} disabled={sessionsLoading || !selectedWorkspaceId}>
            <RefreshCw className={cn("size-3.5", sessionsLoading && "animate-spin")} />
            Refresh sessions
          </Button>
        </CardContent>
        {sessionsError && (
          <div className="mx-4 mb-4 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>{sessionsError}</span>
          </div>
        )}
        {!sessionsLoading && !sessionsError && selectedWorkspaceId && connectedSessions.length === 0 && (
          <div className="mx-4 mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-amber-400/30 bg-amber-50/60 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/20 dark:text-amber-300" role="status">
            <AlertTriangle className="size-4 shrink-0" />
            <span>No connected session is available. Connect one under Sessions before generating.</span>
            <Link href="/dashboard/sessions" className="font-medium underline underline-offset-2">Open Sessions</Link>
          </div>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(300px,0.9fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Integration settings</CardTitle>
            <CardDescription>These values are written into the generated hook file. The API key is never collected here.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="whmcs-api-url">Public Dashboard API URL <span className="text-destructive">*</span></Label>
              <Input
                id="whmcs-api-url"
                value={apiUrl}
                onChange={(event) => { setApiUrl(event.target.value); setGeneratedCode(null); setValidationError(null) }}
                placeholder="https://api.example.com"
                inputMode="url"
                autoComplete="url"
                aria-describedby="whmcs-api-url-help"
              />
              <p id="whmcs-api-url-help" className="text-xs text-muted-foreground">Use the public HTTPS origin of Dashboard API, not the internal Docker hostname.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="whmcs-opt-in-field">WhatsApp opt-in custom field <span className="text-destructive">*</span></Label>
                <Input
                  id="whmcs-opt-in-field"
                  value={optInField}
                  onChange={(event) => { setOptInField(event.target.value); setGeneratedCode(null); setValidationError(null) }}
                  maxLength={120}
                  aria-describedby="whmcs-opt-in-field-help"
                />
                <p id="whmcs-opt-in-field-help" className="text-xs text-muted-foreground">Must match the WHMCS client custom field name exactly.</p>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="whmcs-opt-in-values">Accepted opt-in values <span className="text-destructive">*</span></Label>
                <Input
                  id="whmcs-opt-in-values"
                  value={optInValues}
                  onChange={(event) => { setOptInValues(event.target.value); setGeneratedCode(null); setValidationError(null) }}
                  maxLength={240}
                  aria-describedby="whmcs-opt-in-values-help"
                />
                <p id="whmcs-opt-in-values-help" className="text-xs text-muted-foreground">Comma-separated, case-insensitive. Checkbox fields often use <code>on</code> or <code>1</code>.</p>
              </div>
            </div>
            <div className="rounded-lg border border-border/80 bg-muted/25 px-3 py-2.5 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Runtime secrets:</span> set <code>WASPHERE_API_URL</code>, <code>WASPHERE_WORKSPACE_ID</code>, <code>WASPHERE_SESSION_ID</code>, and <code>WASPHERE_API_KEY</code> in the WHMCS environment. The generated file never contains a raw key.
            </div>
          </CardContent>
        </Card>

        <Card className="border-primary/25">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><ShieldCheck className="size-4 text-primary" /> API key requirements</CardTitle>
            <CardDescription>Create a dedicated key for this integration.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="rounded-lg border bg-muted/25 p-3">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Exact required scopes</p>
              <p className="mt-1 font-mono text-sm text-foreground">messages:send + sessions:read</p>
              <p className="mt-2 text-xs text-muted-foreground">Bind the key to the selected session when you create it. Keep the key in WHMCS environment storage.</p>
            </div>
            <Link href="/dashboard/developer" className={cn(buttonVariants({ variant: "outline" }), "w-full justify-center")}>
              Open Developer <ExternalLink className="size-3.5" />
            </Link>
            <p className="text-xs leading-relaxed text-muted-foreground">The hook uses the existing workspace proxy and a bounded 5-second connect / 10-second request timeout. Failures are recorded with WHMCS <code>logActivity</code> without logging the key.</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>WHMCS events</CardTitle>
          <CardDescription>Only enabled events register hooks and can send. Templates support {PLACEHOLDERS}.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {WHMCS_EVENT_DEFINITIONS.map((definition) => {
            const event = events[definition.key]
            const templateId = `whmcs-template-${definition.key}`
            return (
              <div key={definition.key} className={cn("rounded-xl border p-4 transition-colors", event.enabled ? "border-primary/30 bg-primary/[0.025]" : "border-border/80 bg-muted/10")}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <input
                      id={`whmcs-enabled-${definition.key}`}
                      type="checkbox"
                      checked={event.enabled}
                      onChange={(input) => updateEvent(definition.key, { enabled: input.target.checked })}
                      className="mt-1 size-4 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    />
                    <div>
                      <Label htmlFor={`whmcs-enabled-${definition.key}`} className="cursor-pointer text-sm font-semibold">{definition.label}</Label>
                      <p className="mt-1 text-xs text-muted-foreground">{definition.description} <code>{definition.key}</code></p>
                    </div>
                  </div>
                  <Badge variant={event.enabled ? "secondary" : "outline"} className={event.enabled ? "bg-primary/10 text-primary" : "text-muted-foreground"}>
                    {event.enabled ? "Enabled" : "Disabled"}
                  </Badge>
                </div>
                <div className="mt-3 flex flex-col gap-1.5">
                  <Label htmlFor={templateId}>Message template</Label>
                  <Textarea
                    id={templateId}
                    value={event.template}
                    onChange={(input) => updateEvent(definition.key, { template: input.target.value })}
                    disabled={!event.enabled}
                    maxLength={4000}
                    rows={2}
                    aria-describedby={`${templateId}-help`}
                    className="resize-y font-mono text-xs leading-relaxed"
                  />
                  <p id={`${templateId}-help`} className="text-xs text-muted-foreground">Placeholders are replaced from the WHMCS hook context; unknown placeholders are removed.</p>
                </div>
              </div>
            )
          })}
        </CardContent>
      </Card>

      <Card className="overflow-hidden border-primary/25">
        <CardHeader className="flex-row items-center justify-between gap-3 border-b bg-muted/20">
          <div>
            <CardTitle>Generate integration</CardTitle>
            <CardDescription>Downloads as <code>wasphere_notifications.php</code> for <code>includes/hooks/</code>.</CardDescription>
          </div>
          <Button type="button" onClick={handleGenerate} disabled={!sessionReady || workspaceLoading}>
            Generate PHP
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 pt-4">
          {validationError && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>{validationError}</span>
            </div>
          )}
          {!generatedCode ? (
            <div className="rounded-xl border border-dashed border-border bg-muted/15 px-5 py-8 text-center">
              <p className="text-sm font-medium text-foreground">Ready when your binding is complete</p>
              <p className="mt-1 text-xs text-muted-foreground">Choose a connected session, fill the public API URL, then generate locally in your browser.</p>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-muted-foreground">Generated locally. Review it, then copy or download it into WHMCS.</p>
                <div className="flex items-center gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => void handleCopy()}>
                    {copied ? <Check className="size-3.5 text-primary" /> : <Copy className="size-3.5" />}
                    {copied ? "Copied" : "Copy"}
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={handleDownload}>
                    <Download className="size-3.5" /> Download
                  </Button>
                </div>
              </div>
              <pre className="max-h-[620px] overflow-auto rounded-xl border bg-zinc-950 p-4 text-[11px] leading-relaxed text-zinc-100 shadow-inner" tabIndex={0} aria-label="Generated WHMCS PHP integration">
                <code>{generatedCode}</code>
              </pre>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
