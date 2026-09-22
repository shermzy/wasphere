"use client"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"

type SessionAction = "delete" | "logout" | "relink" | "retry"

const ACTION_COPY: Record<SessionAction, {
  title: string
  consequence: string
  confirm: string
  danger?: boolean
}> = {
  delete: {
    title: "Delete session",
    consequence: "This permanently disconnects WhatsApp and deletes the saved credentials. It cannot be undone.",
    confirm: "Delete session",
    danger: true,
  },
  logout: {
    title: "Log out session",
    consequence: "This logs the WhatsApp account out and clears its saved credentials. You will need to scan a new QR code to reconnect.",
    confirm: "Log out session",
    danger: true,
  },
  relink: {
    title: "Relink session",
    consequence: "This restarts the WhatsApp connection without deleting the saved credentials or session configuration. A new QR code may be required.",
    confirm: "Relink session",
  },
  retry: {
    title: "Retry session",
    consequence: "This restarts the WhatsApp connection without deleting the saved credentials or session configuration. A new QR code may be required.",
    confirm: "Retry session",
  },
}

export interface SessionActionConfirmDialogProps {
  sessionId: string | null
  action: SessionAction
  open: boolean
  submitting?: boolean
  onClose: () => void
  onConfirm: () => void | Promise<void>
}

export function SessionActionConfirmDialog({
  sessionId,
  action,
  open,
  submitting = false,
  onClose,
  onConfirm,
}: SessionActionConfirmDialogProps) {
  if (!sessionId) return null
  const copy = ACTION_COPY[action]

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent showCloseButton>
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>
            Confirm this action for the exact session <span className="font-mono font-medium text-foreground">{sessionId}</span>. {copy.consequence}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={submitting}
            aria-label={`Cancel ${copy.title.toLowerCase()} for session ${sessionId}`}
            className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant={copy.danger ? "destructive" : "default"}
            onClick={() => void onConfirm()}
            disabled={submitting}
            aria-label={`${copy.confirm} ${sessionId}`}
            className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {submitting ? `${copy.confirm}…` : copy.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
