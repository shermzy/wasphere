"use client"

import * as React from "react"
import { toast } from "sonner"
import { Copy, Check, AlertTriangle, Eye, EyeOff } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import type { Webhook } from "@/components/webhooks/webhooks-tab"

// ─── Event groups ─────────────────────────────────────────────────────────────

const EVENT_GROUPS = [
  {
    label: "Messages",
    events: ["message.sent", "message.delivered", "message.read", "message.failed", "message.received", "poll.vote"],
  },
  {
    label: "Sessions",
    events: ["session.connected", "session.disconnected", "session.qr", "session.failed"],
  },
  {
    label: "System",
    events: ["webhook.test"],
  },
] as const

const ALL_EVENTS = EVENT_GROUPS.flatMap((g) => g.events)

const EVENT_LABELS: Record<string, string> = {
  "message.sent": "Message Sent",
  "message.delivered": "Message Delivered",
  "message.read": "Message Read",
  "message.failed": "Message Failed",
  "message.received": "Message Received",
  "poll.vote": "Poll Vote",
  "session.connected": "Session Connected",
  "session.disconnected": "Session Disconnected",
  "session.qr": "Session QR Code",
  "session.failed": "Session Failed",
  "webhook.test": "Test Event",
}

function eventLabel(ev: string): string {
  return EVENT_LABELS[ev] ?? ev.replace(/[._]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

// ─── Signing secret reveal ────────────────────────────────────────────────────

function SecretDisplay({ secret, onDone }: { secret: string; onDone: () => void }) {
  const [copied, setCopied] = React.useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(secret)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error("Failed to copy.")
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-3">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
          This signing secret will not be shown again. Copy it now and store it securely.
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label className="text-sm font-medium text-foreground">Signing Secret</Label>
        <div className="flex items-center gap-2">
          <Input value={secret} readOnly className="font-mono text-xs" aria-label="Signing secret" />
          <Button variant="outline" size="icon" onClick={handleCopy} aria-label={copied ? "Copied" : "Copy"}>
            {copied ? <Check className="size-4 text-green-600" /> : <Copy className="size-4" />}
          </Button>
        </div>
        <p className="text-xs text-zinc-400 font-light">
          Use this to verify HMAC-SHA256 signatures on incoming webhook payloads.
        </p>
      </div>
      <DialogFooter>
        <Button onClick={onDone}>I&apos;ve saved it</Button>
      </DialogFooter>
    </div>
  )
}

// ─── Add dialog ───────────────────────────────────────────────────────────────

export interface WebhookAddDialogProps {
  open: boolean
  onClose: () => void
  onCreated: (webhook: Webhook) => void
}

export function WebhookAddDialog({ open, onClose, onCreated }: WebhookAddDialogProps) {
  const [name, setName] = React.useState("")
  const [url, setUrl] = React.useState("")
  const [urlError, setUrlError] = React.useState<string | null>(null)
  const [selectedEvents, setSelectedEvents] = React.useState<string[]>([])
  const [wildcard, setWildcard] = React.useState(false)
  const [secretMode, setSecretMode] = React.useState<"generate" | "custom">("generate")
  const [customSecret, setCustomSecret] = React.useState("")
  const [customSecretVisible, setCustomSecretVisible] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [signingSecret, setSigningSecret] = React.useState<string | null>(null)

  const reset = () => {
    setName(""); setUrl(""); setUrlError(null)
    setSelectedEvents([]); setWildcard(false); setSecretMode("generate")
    setCustomSecret(""); setCustomSecretVisible(false)
    setSubmitting(false); setError(null); setSigningSecret(null)
  }

  const handleClose = () => { reset(); onClose() }

  const validateUrl = (val: string) => {
    if (!val) { setUrlError(null); return }
    try {
      const parsed = new URL(val)
      if (parsed.protocol !== "https:") {
        setUrlError("URL must use HTTPS.")
      } else {
        setUrlError(null)
      }
    } catch {
      setUrlError("Enter a valid URL.")
    }
  }

  const toggleEvent = (ev: string) =>
    setSelectedEvents((prev) => prev.includes(ev) ? prev.filter((e) => e !== ev) : [...prev, ev])

  const handleWildcard = (checked: boolean) => {
    setWildcard(checked)
    setSelectedEvents(checked ? [...ALL_EVENTS] : [])
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (urlError) return
    const events = wildcard ? ["*"] : selectedEvents
    if (events.length === 0) { setError("Select at least one event."); return }
    if (secretMode === "custom") {
      if (/\p{Cc}/u.test(customSecret)) {
        setError("Signing secret must not contain control characters.")
        return
      }
      const length = customSecret.trim().length
      if (length < 32 || length > 256) {
        setError("Signing secret must be 32–256 characters after trimming.")
        return
      }
    }

    setSubmitting(true)
    try {
      const res = await fetch("/api/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          url,
          events,
          ...(secretMode === "custom" ? { signingSecret: customSecret } : {}),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const msg = Array.isArray(data.message) ? data.message.join("\n") : (data.message ?? "Failed to create webhook.")
        setError(msg); return
      }
      if (typeof data.signingSecret !== "string") {
        setError("Webhook was saved, but its one-time signing secret was not returned.")
        return
      }
      setSigningSecret(data.signingSecret)
      onCreated(data as Webhook)
    } catch {
      setError("Could not reach the server.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <DialogContent showCloseButton className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{signingSecret ? "Webhook Created" : "Add Webhook"}</DialogTitle>
        </DialogHeader>

        {signingSecret ? (
          <SecretDisplay secret={signingSecret} onDone={handleClose} />
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {/* Name */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="wh-name" className="text-sm font-medium text-foreground">Name</Label>
              <Input
                id="wh-name"
                placeholder="e.g. Production alerts"
                className="placeholder:text-zinc-400 placeholder:font-light"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={64}
                required
                autoFocus
              />
            </div>

            {/* URL */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="wh-url" className="text-sm font-medium text-foreground">URL</Label>
              <Input
                id="wh-url"
                placeholder="https://your-server.com/webhook"
                className="placeholder:text-zinc-400 placeholder:font-light"
                value={url}
                onChange={(e) => { setUrl(e.target.value); validateUrl(e.target.value) }}
                required
              />
              {urlError && <p className="text-xs text-destructive" role="alert" aria-live="assertive">{urlError}</p>}
            </div>

            {/* Events */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium text-foreground">Events</Label>
                <label className="flex items-center gap-1.5 cursor-pointer select-none">
                  <Checkbox
                    checked={wildcard}
                    onCheckedChange={(v) => handleWildcard(v === true)}
                    aria-label="Subscribe to all webhook events"
                  />
                  <span className="text-xs text-zinc-700 dark:text-zinc-300">All (*)</span>
                </label>
              </div>
              <div className="flex flex-col gap-3 rounded-lg border p-3">
                {EVENT_GROUPS.map((group) => (
                  <div key={group.label} className="flex flex-col gap-1.5">
                    <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">{group.label}</p>
                    <div className="grid grid-cols-2 gap-1">
                      {group.events.map((ev) => (
                        <label key={ev} className="flex items-center gap-1.5 cursor-pointer select-none">
                          <Checkbox
                            checked={selectedEvents.includes(ev)}
                            onCheckedChange={() => toggleEvent(ev)}
                            disabled={wildcard}
                            aria-label={`Subscribe to ${eventLabel(ev)}`}
                          />
                          <span className="text-xs text-zinc-700 dark:text-zinc-300">{eventLabel(ev)}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Signing secret */}
            <div className="flex flex-col gap-2">
              <Label className="text-sm font-medium text-foreground">Signing secret</Label>
              <RadioGroup
                value={secretMode}
                onValueChange={(value) => setSecretMode(value as "generate" | "custom")}
                className="grid grid-cols-1 gap-2 sm:grid-cols-2"
              >
                <label htmlFor="wh-secret-generate" className="flex cursor-pointer items-start gap-2 rounded-lg border border-input p-3 transition-colors hover:bg-muted/40 has-[[data-checked]]:border-primary has-[[data-checked]]:bg-primary/5">
                  <RadioGroupItem id="wh-secret-generate" value="generate" className="mt-0.5" />
                  <span className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium">Generate automatically</span>
                    <span className="text-xs text-muted-foreground">Recommended for most integrations.</span>
                  </span>
                </label>
                <label htmlFor="wh-secret-custom" className="flex cursor-pointer items-start gap-2 rounded-lg border border-input p-3 transition-colors hover:bg-muted/40 has-[[data-checked]]:border-primary has-[[data-checked]]:bg-primary/5">
                  <RadioGroupItem id="wh-secret-custom" value="custom" className="mt-0.5" />
                  <span className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium">Use my secret</span>
                    <span className="text-xs text-muted-foreground">Bring an existing integration secret.</span>
                  </span>
                </label>
              </RadioGroup>
              {secretMode === "custom" && (
                <div className="flex flex-col gap-1.5">
                  <div className="relative">
                    <Input
                      id="wh-custom-secret"
                      type={customSecretVisible ? "text" : "password"}
                      value={customSecret}
                      onChange={(e) => setCustomSecret(e.target.value)}
                      placeholder="32–256 characters"
                      maxLength={256}
                      autoComplete="new-password"
                      className="pr-10 font-mono text-xs placeholder:font-sans"
                      aria-label="Custom signing secret"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="absolute right-1 top-1/2 -translate-y-1/2"
                      onClick={() => setCustomSecretVisible((visible) => !visible)}
                      aria-label={customSecretVisible ? "Hide signing secret" : "Show signing secret"}
                    >
                      {customSecretVisible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">The value is trimmed, validated, and shown once after creation.</p>
                </div>
              )}
            </div>

            {error && <p className="text-xs text-destructive whitespace-pre-line" role="alert" aria-live="assertive">{error}</p>}

            <DialogFooter showCloseButton>
              <Button type="submit" disabled={submitting || !!urlError}>
                {submitting ? "Creating…" : "Create Webhook"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
