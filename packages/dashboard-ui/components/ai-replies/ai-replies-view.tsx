"use client"

import * as React from "react"
import Link from "next/link"
import { Copy, WandSparkles } from "lucide-react"
import { generateAiReply } from "@/app/dashboard/ai-replies/actions"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type { AiReplyDraft, AiReplySource } from "./types"

interface AiRepliesViewProps {
  configured: boolean
  initialConversationId: string
}

function SourceDetail({ source }: { source: AiReplySource }) {
  return (
    <div className="grid gap-2 rounded-lg border bg-muted/30 p-3 text-sm sm:grid-cols-2">
      <div><span className="text-muted-foreground">Conversation:</span> <code>{source.conversationId}</code></div>
      <div><span className="text-muted-foreground">Session:</span> <code>{source.sessionId}</code></div>
      <div><span className="text-muted-foreground">Contact:</span> <code>{source.contactId}</code></div>
      <div><span className="text-muted-foreground">Contact JID:</span> <code>{source.contactJid}</code></div>
      <div className="sm:col-span-2"><span className="text-muted-foreground">Contact name:</span> {source.contactName ?? "Unnamed"}</div>
    </div>
  )
}

export function AiRepliesView({ configured, initialConversationId }: AiRepliesViewProps) {
  const [conversationId, setConversationId] = React.useState(initialConversationId)
  const [tone, setTone] = React.useState("")
  const [instruction, setInstruction] = React.useState("")
  const [draft, setDraft] = React.useState<AiReplyDraft | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [copied, setCopied] = React.useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    setCopied(false)
    setBusy(true)
    try {
      const result = await generateAiReply({
        conversationId: conversationId.trim(),
        tone: tone.trim() || undefined,
        instruction: instruction.trim() || undefined,
      })
      if (!result.ok || !result.data) {
        setError(result.message ?? "Could not generate a draft.")
        return
      }
      setDraft(result.data)
    } finally {
      setBusy(false)
    }
  }

  const copyDraft = async () => {
    if (!draft) return
    await navigator.clipboard.writeText(draft.draft)
    setCopied(true)
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <div>
        <p className="text-sm font-medium text-primary">AI Replies Pro</p>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Draft a reply for review</h1>
        <p className="mt-1 text-sm text-muted-foreground">AI creates a suggestion only. Review, edit, and send it yourself from Inbox.</p>
      </div>

      {!configured ? (
        <Card>
          <CardHeader>
            <CardTitle>Operator setup required</CardTitle>
            <CardDescription>Configure AI_REPLY_BASE_URL, AI_REPLY_API_KEY, and AI_REPLY_MODEL on the dashboard API, then restart it.</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <Card>
            <CardHeader>
              <CardTitle>Source conversation</CardTitle>
              <CardDescription>Enter one exact conversation ID. The server reloads its workspace-owned context.</CardDescription>
            </CardHeader>
            <CardContent>
              <form className="grid gap-4" onSubmit={submit}>
                <div className="grid gap-2">
                  <Label htmlFor="conversation-id">Conversation ID</Label>
                  <Input id="conversation-id" value={conversationId} onChange={(event) => setConversationId(event.target.value)} required maxLength={100} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="tone">Tone <span className="text-muted-foreground">(optional)</span></Label>
                  <Input id="tone" value={tone} onChange={(event) => setTone(event.target.value)} maxLength={40} placeholder="Warm and concise" />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="instruction">Instruction <span className="text-muted-foreground">(optional)</span></Label>
                  <Textarea id="instruction" value={instruction} onChange={(event) => setInstruction(event.target.value)} maxLength={500} placeholder="Acknowledge the delay and offer the next step." />
                </div>
                {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
                <Button type="submit" disabled={busy}>
                  <WandSparkles />
                  {busy ? "Drafting…" : "Generate draft"}
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Suggested reply</CardTitle>
              <CardDescription>Nothing is sent or saved by AI Replies Pro.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              {draft ? (
                <>
                  <SourceDetail source={draft.source} />
                  <Textarea aria-label="Editable draft" className="min-h-48" value={draft.draft} onChange={(event) => setDraft({ ...draft, draft: event.target.value })} />
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" onClick={copyDraft}><Copy />{copied ? "Copied" : "Copy"}</Button>
                    <Button
                      variant="link"
                      render={<Link href={"/dashboard/inbox?conversationId=" + encodeURIComponent(draft.source.conversationId)} />}
                    >
                      Open in Inbox
                    </Button>
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Your editable draft and its exact source identifiers will appear here.</p>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
