"use client"

import * as React from "react"
import Link from "next/link"
import { toast } from "sonner"
import {
  Globe, KeyRound, Eye, EyeOff, Building2, CheckCircle2,
  Server, ShieldCheck, Copy, Check, ExternalLink, Plug, XCircle, Loader2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export interface Workspace {
  id: string
  name: string
  logo?: string | null
  waServerUrl?: string | null
  waServerToken?: string | null
  waServerConfigured: boolean
}

interface SettingsFormProps {
  workspace: Workspace
  /** Environment-aware default/placeholder for the WA Server URL field. */
  suggestedWaServerUrl?: string
}

type TestResult = { ok: boolean; message: string } | null

// ─── Shared card header icon ──────────────────────────────────────────────────

function SectionIcon({ icon: Icon, className = "" }: { icon: React.ElementType; className?: string }) {
  return (
    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 ${className}`}>
      <Icon size={17} className="text-primary" />
    </div>
  )
}

// ─── Main form ────────────────────────────────────────────────────────────────

export function SettingsForm({ workspace, suggestedWaServerUrl = "http://localhost:3001" }: SettingsFormProps) {
  // WA Server state — prefill the suggested URL on first install (no value saved yet).
  const [waServerUrl, setWaServerUrl] = React.useState(workspace.waServerUrl || suggestedWaServerUrl)
  const [waServerToken, setWaServerToken] = React.useState(workspace.waServerToken ?? "")
  const [showToken, setShowToken] = React.useState(false)
  const [configError, setConfigError] = React.useState<string | null>(null)
  const [configSubmitting, setConfigSubmitting] = React.useState(false)

  // Test Connection state
  const [testing, setTesting] = React.useState(false)
  const [testResult, setTestResult] = React.useState<TestResult>(null)

  const handleTestConnection = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const res = await fetch("/api/settings/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: waServerUrl, token: waServerToken }),
      })
      const data = await res.json().catch(() => ({}))
      setTestResult({ ok: Boolean(data.ok), message: data.message ?? "Test failed." })
    } catch {
      setTestResult({ ok: false, message: "Could not reach the dashboard server." })
    } finally {
      setTesting(false)
    }
  }

  // Workspace name state
  const [name, setName] = React.useState(workspace.name)
  const [nameError, setNameError] = React.useState<string | null>(null)
  const [nameSubmitting, setNameSubmitting] = React.useState(false)

  // Workspace ID copy state
  const [wsCopied, setWsCopied] = React.useState(false)

  const copyWorkspaceId = async () => {
    await navigator.clipboard.writeText(workspace.id).catch(() => null)
    setWsCopied(true)
    setTimeout(() => setWsCopied(false), 2000)
  }

  const handleConfigSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setConfigError(null)
    setConfigSubmitting(true)
    try {
      const res = await fetch("/api/settings/workspace", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ waServerUrl, waServerToken }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setConfigError(Array.isArray(data.message) ? data.message.join(" ") : (data.message ?? "Failed to save."))
        return
      }
      toast.success("WA Server configuration saved.")
    } catch {
      setConfigError("Could not reach the server.")
    } finally {
      setConfigSubmitting(false)
    }
  }

  const handleNameSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setNameError(null)
    setNameSubmitting(true)
    try {
      const res = await fetch("/api/settings/workspace", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setNameError(Array.isArray(data.message) ? data.message.join(" ") : (data.message ?? "Failed to update."))
        return
      }
      toast.success("Workspace name updated.")
    } catch {
      setNameError("Could not reach the server.")
    } finally {
      setNameSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">

      {/* ── Row 1: WA Server (full width) ── */}
      <Card className="border-primary/20 [background-image:radial-gradient(hsl(var(--primary)/0.04)_1px,transparent_1px)] [background-size:20px_20px]">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-3">
            <SectionIcon icon={Server} />
            <div className="min-w-0">
              <CardTitle className="text-base font-semibold text-foreground">WA Server</CardTitle>
              <CardDescription className="text-xs text-zinc-400 font-light mt-0.5">
                Connect your self-hosted WhatsApp gateway
              </CardDescription>
            </div>
            {workspace.waServerConfigured && (
              <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-green-500/10 px-2.5 py-1 text-xs font-medium text-green-700 dark:text-green-400 shrink-0">
                <CheckCircle2 size={12} />
                Connected
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent className="bg-background/60 rounded-b-xl pt-4 border-t border-primary/10">
          <form onSubmit={handleConfigSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="wa-server-url" className="text-sm font-medium text-foreground flex items-center gap-1.5">
                <Globe size={13} className="text-zinc-400" />
                Server URL
              </Label>
              <Input
                id="wa-server-url"
                type="url"
                placeholder={suggestedWaServerUrl}
                value={waServerUrl}
                onChange={(e) => { setWaServerUrl(e.target.value); setTestResult(null) }}
                className="placeholder:text-zinc-400 placeholder:font-light font-mono text-sm"
              />
              <p className="text-xs text-zinc-400 font-light leading-relaxed">
                Internal URL where the dashboard reaches wa-server.<br />
                <span className="font-mono">Docker:</span> http://wa-server:3001 (compose service name)<br />
                <span className="font-mono">Manual:</span> http://localhost:3001 (or your server IP:port)<br />
                <span className="font-mono">Kubernetes:</span> http://wa-server.&lt;namespace&gt;.svc.cluster.local:3001
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="wa-server-token" className="text-sm font-medium text-foreground flex items-center gap-1.5">
                <KeyRound size={13} className="text-zinc-400" />
                API Token
              </Label>
              <div className="flex gap-2">
                <Input
                  id="wa-server-token"
                  type={showToken ? "text" : "password"}
                  placeholder="Paste your WA_TOKEN here"
                  value={waServerToken}
                  onChange={(e) => setWaServerToken(e.target.value)}
                  className="flex-1 placeholder:text-zinc-400 placeholder:font-light font-mono text-sm"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setShowToken((v) => !v)}
                  className="shrink-0"
                  aria-label={showToken ? "Hide token" : "Show token"}
                >
                  {showToken ? <EyeOff size={15} /> : <Eye size={15} />}
                </Button>
              </div>
              <p className="text-xs text-zinc-400 font-light">Stored encrypted at rest. Never exposed in responses.</p>
            </div>

            {configError && <p className="text-xs text-destructive sm:col-span-2" role="alert" aria-live="assertive">{configError}</p>}

            {testResult && (
              <div
                className={`sm:col-span-2 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${
                  testResult.ok
                    ? "border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-300"
                    : "border-destructive/30 bg-destructive/5 text-destructive"
                }`}
              >
                {testResult.ok
                  ? <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
                  : <XCircle size={14} className="mt-0.5 shrink-0" />}
                <span role="status" aria-live="polite">{testResult.message}</span>
              </div>
            )}

            <div className="sm:col-span-2 flex items-center gap-2">
              <Button type="submit" disabled={configSubmitting} size="sm">
                {configSubmitting ? "Saving…" : "Save Configuration"}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleTestConnection}
                disabled={testing || !waServerUrl.trim()}
                className="gap-1.5"
              >
                {testing ? <Loader2 size={13} className="animate-spin" /> : <Plug size={13} />}
                {testing ? "Testing…" : "Test Connection"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* ── Row 2: Workspace + Security side-by-side ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Workspace */}
        <Card className="border-primary/20 [background-image:radial-gradient(hsl(var(--primary)/0.04)_1px,transparent_1px)] [background-size:20px_20px]">
          <CardHeader className="pb-4">
            <div className="flex items-center gap-3">
              <SectionIcon icon={Building2} />
              <div>
                <CardTitle className="text-base font-semibold text-foreground">Workspace</CardTitle>
                <CardDescription className="text-xs text-zinc-400 font-light mt-0.5">
                  Rename or manage your workspace
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="bg-background/60 rounded-b-xl pt-4 border-t border-primary/10">
            <form onSubmit={handleNameSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="workspace-name" className="text-sm font-medium text-foreground flex items-center gap-1.5">
                  <Building2 size={13} className="text-zinc-400" />
                  Workspace Name
                </Label>
                <Input
                  id="workspace-name"
                  type="text"
                  placeholder="My Workspace"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="placeholder:text-zinc-400 placeholder:font-light"
                />
              </div>
              {nameError && <p className="text-xs text-destructive" role="alert" aria-live="assertive">{nameError}</p>}
              <div>
                <Button type="submit" disabled={nameSubmitting} size="sm">
                  {nameSubmitting ? "Saving…" : "Save Name"}
                </Button>
              </div>
            </form>

            {/* Workspace ID — copyable, for use in API calls */}
            <div className="mt-5 pt-4 border-t flex flex-col gap-1.5">
              <p className="text-sm font-medium text-foreground">Workspace ID</p>
              <p className="text-xs text-zinc-400 font-light">
                Use this UUID to identify your workspace in direct API calls.
              </p>
              <div className="flex items-center gap-2 mt-1">
                <Input
                  value={workspace.id}
                  readOnly
                  className="font-mono text-xs text-zinc-600 dark:text-zinc-300 bg-muted/40"
                  aria-label="Workspace ID"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={copyWorkspaceId}
                  className="shrink-0"
                  aria-label={wsCopied ? "Copied" : "Copy workspace ID"}
                >
                  {wsCopied ? <Check size={14} className="text-green-600" /> : <Copy size={14} />}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Security */}
        <Card className="border-primary/20 [background-image:radial-gradient(hsl(var(--primary)/0.04)_1px,transparent_1px)] [background-size:20px_20px]">
          <CardHeader className="pb-4">
            <div className="flex items-center gap-3">
              <SectionIcon icon={ShieldCheck} />
              <div>
                <CardTitle className="text-base font-semibold text-foreground">Security</CardTitle>
                <CardDescription className="text-xs text-zinc-400 font-light mt-0.5">
                  API token management and audit access
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="bg-background/60 rounded-b-xl pt-4 border-t border-primary/10 flex flex-col gap-5">

            {/* Dashboard API keys */}
            <div className="flex flex-col gap-2">
              <div>
                <p className="text-sm font-medium text-foreground">Dashboard API keys</p>
                <p className="text-xs text-zinc-400 font-light mt-0.5">
                  Manage keys for Dashboard/Admin API integrations. These are separate from the WA Server API token (<code>WA_TOKEN</code>) configured above.
                </p>
              </div>
              <Link
                href="/dashboard/developer?tab=api-keys"
                className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-primary underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                Open API key management <ExternalLink size={12} />
              </Link>
            </div>

            {/* Audit log link */}
            <div className="border-t pt-4 flex flex-col gap-1">
              <p className="text-sm font-medium text-foreground">Audit Log</p>
              <p className="text-xs text-zinc-400 font-light">
                View all API requests made in this workspace.
              </p>
              <Link
                href="/dashboard/developer?tab=audit-log"
                className="inline-flex items-center gap-1.5 mt-1.5 text-sm font-medium text-primary underline underline-offset-2"
              >
                Open Audit Log <ExternalLink size={12} />
              </Link>
            </div>

          </CardContent>
        </Card>
      </div>

    </div>
  )
}
