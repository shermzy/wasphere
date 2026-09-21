"use client"

import * as React from "react"
import { Check, Copy, ExternalLink, KeyRound, ShieldCheck } from "lucide-react"
import { ApiKeyAddDialog } from "@/components/developer/api-key-add-dialog"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

interface NotionMcpCardProps {
  canManageApiKeys: boolean
  mcpUrl: string
}

export function NotionMcpCard({ canManageApiKeys, mcpUrl }: NotionMcpCardProps) {
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [copied, setCopied] = React.useState(false)

  const copyUrl = async () => {
    await navigator.clipboard.writeText(mcpUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <>
      <Card className="border-primary/20 [background-image:radial-gradient(hsl(var(--primary)/0.04)_1px,transparent_1px)] [background-size:20px_20px]">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10">
              <KeyRound size={17} className="text-primary" />
            </div>
            <div className="min-w-0">
              <CardTitle className="text-base font-semibold text-foreground">Notion MCP connection</CardTitle>
              <CardDescription className="mt-0.5">
                Generate a workspace-scoped key and connect a Notion Custom Agent to WaSphere.
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium text-foreground">MCP server URL</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <code className="min-w-0 flex-1 overflow-x-auto rounded-md border bg-muted/40 px-3 py-2 text-xs text-foreground">
                {mcpUrl}
              </code>
              <Button type="button" variant="outline" size="sm" onClick={copyUrl} className="shrink-0">
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                {copied ? "Copied" : "Copy URL"}
              </Button>
              <span className="sr-only" aria-live="polite">{copied ? "MCP URL copied" : ""}</span>
            </div>
          </div>

          <ol className="grid gap-3 text-sm text-muted-foreground">
            <li><span className="font-medium text-foreground">1.</span> In Notion, an admin enables custom MCP servers under <span className="font-medium text-foreground">Settings → Connections</span>. This requires a Business or Enterprise plan.</li>
            <li><span className="font-medium text-foreground">2.</span> In the Custom Agent, open <span className="font-medium text-foreground">Settings → Tools &amp; Access → Add connection → Custom MCP server</span> and enter the URL above.</li>
            <li><span className="font-medium text-foreground">3.</span> Generate a key below. Select <code className="text-xs text-foreground">messages:read</code>; add <code className="text-xs text-foreground">messages:send</code> only if the agent may send, and bind it to the exact session it should use.</li>
            <li><span className="font-medium text-foreground">4.</span> Choose header-based authentication in Notion and use <code className="text-xs text-foreground">Authorization: Bearer &lt;key&gt;</code>. The key is shown once.</li>
            <li><span className="font-medium text-foreground">5.</span> Let <code className="text-xs text-foreground">resolve_project_route</code> run automatically, but keep <code className="text-xs text-foreground">send_project_update</code> set to <span className="font-medium text-foreground">Always ask</span>.</li>
          </ol>

          <div className="flex flex-col gap-3 rounded-lg border border-primary/15 bg-primary/[0.03] p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-2">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
              <p className="text-sm text-muted-foreground">
                {canManageApiKeys
                  ? "The key is restricted to this active workspace and the permissions and session you select."
                  : "Your role can view these instructions but cannot create API keys. Ask a workspace owner or admin to grant API key access or create one for you."}
              </p>
            </div>
            {canManageApiKeys && (
              <Button type="button" onClick={() => setDialogOpen(true)} className="shrink-0">
                <KeyRound className="size-4" />
                Generate API key
              </Button>
            )}
          </div>

          <a
            href="https://www.notion.com/help/mcp-connections-for-custom-agents"
            target="_blank"
            rel="noreferrer"
            className="inline-flex w-fit items-center gap-1 text-sm font-medium text-primary hover:underline"
          >
            Read Notion&apos;s MCP setup guide <ExternalLink className="size-3.5" />
          </a>
        </CardContent>
      </Card>

      {canManageApiKeys && (
        <ApiKeyAddDialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          onCreated={() => undefined}
        />
      )}
    </>
  )
}
