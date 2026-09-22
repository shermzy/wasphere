"use client"

import * as React from "react"
import { toast } from "sonner"
import { AlertTriangle, Check, Copy, Eye, EyeOff } from "lucide-react"
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
import { Switch } from "@/components/ui/switch"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import type { Webhook } from "@/components/webhooks/webhooks-tab"

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
      <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
          The new signing secret will not be shown again. Copy it now and update every integration.
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label className="text-sm font-medium text-foreground">New signing secret</Label>
        <div className="flex items-center gap-2">
          <Input value={secret} readOnly className="font-mono text-xs" aria-label="New signing secret" />
          <Button type="button" variant="outline" size="icon" onClick={handleCopy} aria-label={copied ? "Copied" : "Copy"}>
            {copied ? <Check className="size-4 text-green-600" /> : <Copy className="size-4" />}
          </Button>
        </div>
      </div>
      <DialogFooter>
        <Button type="button" onClick={onDone}>I&apos;ve saved it</Button>
      </DialogFooter>
    </div>
  )
}

export interface WebhookEditDialogProps {
  webhook: Webhook | null
  open: boolean
  onClose: () => void
  onUpdated: (webhook: Webhook) => void
}

export function WebhookEditDialog({ webhook, open, onClose, onUpdated }: WebhookEditDialogProps) {
  const [name, setName] = React.useState("")
  const [url, setUrl] = React.useState("")
  const [urlError, setUrlError] = React.useState<string | null>(null)
  const [selectedEvents, setSelectedEvents] = React.useState<string[]>([])
  const [wildcard, setWildcard] = React.useState(false)
  const [isActive, setIsActive] = React.useState(true)
  const [secretMode, setSecretMode] = React.useState<"keep" | "rotate">("keep")
  const [rotationSecret, setRotationSecret] = React.useState("")
  const [rotationSecretVisible, setRotationSecretVisible] = React.useState(false)
  const [rotationConfirmed, setRotationConfirmed] = React.useState(false)
  const [rotatedSecret, setRotatedSecret] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!webhook) return
    setName(webhook.name)
    setUrl(webhook.url)
    setUrlError(null)
    setIsActive(webhook.isActive)
    setSecretMode("keep")
    setRotationSecret("")
    setRotationSecretVisible(false)
    setRotationConfirmed(false)
    setRotatedSecret(null)
    setError(null)
    if (webhook.events.length === 1 && webhook.events[0] === "*") {
      setWildcard(true)
      setSelectedEvents([...ALL_EVENTS])
    } else {
      setWildcard(false)
      setSelectedEvents(webhook.events)
    }
  }, [webhook])

  const validateUrl = (val: string) => {
    if (!val) { setUrlError(null); return }
    try {
      const parsed = new URL(val)
      setUrlError(parsed.protocol !== "https:" ? "URL must use HTTPS." : null)
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
    if (!webhook) return
    setError(null)
    if (urlError) return
    const events = wildcard ? ["*"] : selectedEvents
    if (events.length === 0) { setError("Select at least one event."); return }
    if (secretMode === "rotate") {
      if (!rotationConfirmed) {
        setError("Confirm that existing integrations must be updated before rotating the secret.")
        return
      }
      if (/\p{Cc}/u.test(rotationSecret)) {
        setError("Signing secret must not contain control characters.")
        return
      }
      const length = rotationSecret.trim().length
      if (length < 32 || length > 256) {
        setError("Signing secret must be 32–256 characters after trimming.")
        return
      }
    }

    setSubmitting(true)
    try {
      const res = await fetch(`/api/webhooks/${webhook.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          url,
          events,
          isActive,
          ...(secretMode === "rotate" ? { signingSecret: rotationSecret } : {}),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const msg = Array.isArray(data.message) ? data.message.join("\n") : (data.message ?? "Failed to update webhook.")
        setError(msg); return
      }
      onUpdated(data as Webhook)
      if (secretMode === "rotate") {
        if (typeof data.signingSecret !== "string") {
          setError("Webhook was saved, but its one-time signing secret was not returned.")
          return
        }
        setRotatedSecret(data.signingSecret)
      } else {
        onClose()
      }
    } catch {
      setError("Could not reach the server.")
    } finally {
      setSubmitting(false)
    }
  }

  if (!webhook) return null

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent showCloseButton className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{rotatedSecret ? "Signing Secret Rotated" : "Edit Webhook"}</DialogTitle>
        </DialogHeader>

        {rotatedSecret ? (
          <SecretDisplay secret={rotatedSecret} onDone={onClose} />
        ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* Name */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-wh-name" className="text-sm font-medium text-foreground">Name</Label>
            <Input
              id="edit-wh-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={64}
              required
              className="placeholder:text-zinc-400 placeholder:font-light"
            />
          </div>

          {/* URL */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-wh-url" className="text-sm font-medium text-foreground">URL</Label>
            <Input
              id="edit-wh-url"
              value={url}
              onChange={(e) => { setUrl(e.target.value); validateUrl(e.target.value) }}
              required
              className="placeholder:text-zinc-400 placeholder:font-light"
            />
            {urlError && <p className="text-xs text-destructive" role="alert" aria-live="assertive">{urlError}</p>}
          </div>

          {/* Active toggle */}
          <div className="flex items-center justify-between">
            <Label htmlFor="edit-wh-active" className="text-sm font-medium text-foreground">Active</Label>
            <Switch id="edit-wh-active" checked={isActive} onCheckedChange={setIsActive} />
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
              onValueChange={(value) => {
                const mode = value as "keep" | "rotate"
                setSecretMode(mode)
                if (mode === "keep") setRotationConfirmed(false)
              }}
              className="grid grid-cols-1 gap-2 sm:grid-cols-2"
            >
              <label htmlFor="edit-secret-keep" className="flex cursor-pointer items-start gap-2 rounded-lg border border-input p-3 transition-colors hover:bg-muted/40 has-[[data-checked]]:border-primary has-[[data-checked]]:bg-primary/5">
                <RadioGroupItem id="edit-secret-keep" value="keep" className="mt-0.5" />
                <span className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">Keep current secret</span>
                  <span className="text-xs text-muted-foreground">No integration changes needed.</span>
                </span>
              </label>
              <label htmlFor="edit-secret-rotate" className="flex cursor-pointer items-start gap-2 rounded-lg border border-input p-3 transition-colors hover:bg-muted/40 has-[[data-checked]]:border-primary has-[[data-checked]]:bg-primary/5">
                <RadioGroupItem id="edit-secret-rotate" value="rotate" className="mt-0.5" />
                <span className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">Rotate secret</span>
                  <span className="text-xs text-muted-foreground">Replace it with a new value.</span>
                </span>
              </label>
            </RadioGroup>
            {secretMode === "rotate" && (
              <div className="flex flex-col gap-3">
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30" role="alert">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    Rotating the secret immediately breaks signatures from integrations still using the current value. Update them after saving.
                  </p>
                </div>
                <div className="relative">
                  <Input
                    id="edit-rotation-secret"
                    type={rotationSecretVisible ? "text" : "password"}
                    value={rotationSecret}
                    onChange={(e) => setRotationSecret(e.target.value)}
                    placeholder="32–256 characters"
                    maxLength={256}
                    autoComplete="new-password"
                    className="pr-10 font-mono text-xs placeholder:font-sans"
                    aria-label="New signing secret"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="absolute right-1 top-1/2 -translate-y-1/2"
                    onClick={() => setRotationSecretVisible((visible) => !visible)}
                    aria-label={rotationSecretVisible ? "Hide signing secret" : "Show signing secret"}
                  >
                    {rotationSecretVisible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </Button>
                </div>
                <label htmlFor="edit-secret-confirm" className="flex items-start gap-2 text-xs text-muted-foreground">
                  <Checkbox id="edit-secret-confirm" checked={rotationConfirmed} onCheckedChange={(checked) => setRotationConfirmed(checked === true)} />
                  <span>I understand that existing integrations must be updated to use the new secret.</span>
                </label>
              </div>
            )}
          </div>

          {error && <p className="text-xs text-destructive whitespace-pre-line" role="alert" aria-live="assertive">{error}</p>}

          <DialogFooter showCloseButton>
            <Button type="submit" disabled={submitting || !!urlError}>
              {submitting ? "Saving…" : "Save Changes"}
            </Button>
          </DialogFooter>
        </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
