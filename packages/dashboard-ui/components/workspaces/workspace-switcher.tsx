"use client"

import * as React from "react"
import {
  Building2,
  Check,
  ChevronsUpDown,
  Loader2,
  Plus,
  RefreshCw,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useSidebar } from "@/components/ui/sidebar"
import { WorkspaceCreateDialog } from "./workspace-create-dialog"
import { useWorkspace } from "./workspace-provider"

function WorkspaceMark({ name }: { name: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-[11px] font-bold text-primary"
    >
      {name.trim().charAt(0).toUpperCase() || <Building2 size={14} />}
    </span>
  )
}

export function WorkspaceSwitcher({ demoMode = false }: { demoMode?: boolean }) {
  const { state, isMobile } = useSidebar()
  const collapsed = !isMobile && state === "collapsed"
  const {
    workspaces,
    selectedWorkspace,
    loading,
    error,
    reloadWorkspaces,
    selectWorkspace,
    createWorkspace,
  } = useWorkspace()
  const [open, setOpen] = React.useState(false)
  const [createOpen, setCreateOpen] = React.useState(false)
  const [switchingId, setSwitchingId] = React.useState<string | null>(null)

  const currentName = selectedWorkspace?.name ?? (loading ? "Loading workspaces…" : "Select workspace")

  async function handleSelect(workspaceId: string) {
    if (workspaceId === selectedWorkspace?.id) {
      setOpen(false)
      return
    }
    setSwitchingId(workspaceId)
    try {
      await selectWorkspace(workspaceId)
    } catch {
      setSwitchingId(null)
    }
  }

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              className="h-9 min-w-0 w-full justify-start gap-2 px-2 text-left hover:bg-accent/60"
              aria-label={`Open workspace switcher${selectedWorkspace ? `, ${selectedWorkspace.name}` : ""}`}
            />
          }
        >
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <WorkspaceMark name={currentName} />
            <span className={collapsed ? "sr-only" : "min-w-0 truncate text-sm font-semibold"}>
              {currentName}
            </span>
          </span>
          {!collapsed && <ChevronsUpDown size={14} className="shrink-0 text-muted-foreground" />}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" sideOffset={8} className="w-64">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
            {loading && workspaces.length === 0 && (
              <DropdownMenuItem disabled>
                <Loader2 size={14} className="animate-spin" /> Loading workspaces…
              </DropdownMenuItem>
            )}
            {!loading && workspaces.length === 0 && !error && (
              <DropdownMenuItem disabled>No workspaces yet</DropdownMenuItem>
            )}
            {error && (
              <>
                <DropdownMenuItem disabled className="whitespace-normal text-destructive">
                  {error}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void reloadWorkspaces()}>
                  <RefreshCw size={14} /> Try again
                </DropdownMenuItem>
              </>
            )}
            {workspaces.map((workspace) => (
              <DropdownMenuItem
                key={workspace.id}
                onSelect={() => void handleSelect(workspace.id)}
                className={workspace.id === selectedWorkspace?.id ? "bg-accent" : ""}
              >
                <WorkspaceMark name={workspace.name} />
                <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
                {switchingId === workspace.id ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : workspace.id === selectedWorkspace?.id ? (
                  <Check size={14} className="text-primary" />
                ) : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
          {!demoMode && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setCreateOpen(true)}>
                <Plus size={14} /> Create workspace
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <WorkspaceCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreate={createWorkspace}
      />
    </>
  )
}
