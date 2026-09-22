"use client";

import { SidebarTrigger } from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import { APP_VERSION } from "@/lib/version";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Moon, Sun, Monitor } from "lucide-react";
import { useAuth } from "@/components/auth/auth-provider";
import { logout } from "@/lib/api";
import { useTheme } from "next-themes";
import { usePathname } from "next/navigation";

const ROUTE_LABELS: Record<string, string> = {
  "/dashboard/overview": "Overview",
  "/dashboard/sessions": "Sessions",
  "/dashboard/inbox": "Inbox",
  "/dashboard/projects": "Projects",
  "/dashboard/contacts": "Contacts",
  "/dashboard/messages": "Messages",
  "/dashboard/webhooks": "Webhooks",
  "/dashboard/team": "Team",
  "/dashboard/developer": "Developer",
  "/dashboard/settings": "Settings",
  "/dashboard/campaigns": "Campaigns",
  "/dashboard/automations": "Automations",
  "/dashboard/crm": "CRM",
  "/dashboard/ai-replies": "AI Replies",
  "/dashboard/whmcs": "WHMCS",
};

export function AppHeader() {
  const { user } = useAuth();
  const { setTheme } = useTheme();
  const pathname = usePathname();

  const routeLabel = ROUTE_LABELS[pathname] ?? Object.entries(ROUTE_LABELS)
    .find(([route]) => pathname.startsWith(`${route}/`))?.[1] ?? null;
  const displayName = user?.name ?? user?.email ?? "…";
  const displayEmail = user?.email ?? "";
  const avatarInitial = (user?.name?.[0] ?? user?.email?.[0] ?? "?").toUpperCase();

  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-border/60 bg-background/85 backdrop-blur-md px-3 gap-2 sticky top-0 z-20">
      {/* Left — trigger + logo + badge */}
      <div className="flex items-center gap-2">
        <SidebarTrigger className="-ml-1 h-7 w-7" />
        <span className="text-muted-foreground/40 text-sm select-none">/</span>
        <span className="text-sm font-medium">WaSphere</span>
        {routeLabel && (
          <>
            <span className="text-muted-foreground/40 text-sm select-none">/</span>
            <span className="text-sm text-muted-foreground">{routeLabel}</span>
          </>
        )}
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 rounded-sm font-medium">
          v{APP_VERSION}
        </Badge>
      </div>

      {/* Right — avatar */}
      <div className="flex items-center gap-1">
        {/* User avatar */}
        <DropdownMenu>
          <DropdownMenuTrigger aria-label={`Open account menu for ${displayName}`}>
            <Avatar className="h-7 w-7 cursor-pointer ring-2 ring-transparent hover:ring-primary/30 transition-all">
              <AvatarFallback className="text-xs bg-primary/10 text-primary font-semibold">
                {avatarInitial}
              </AvatarFallback>
            </Avatar>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="flex flex-col gap-0.5 pb-2">
                <span className="font-semibold text-sm">{displayName}</span>
                <span className="text-xs text-muted-foreground font-normal">
                  {displayEmail}
                </span>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-xs text-muted-foreground font-normal pb-1">
                Theme
              </DropdownMenuLabel>
              <DropdownMenuItem className="gap-2" onClick={() => setTheme("light")}>
                <Sun size={14} /> Light
              </DropdownMenuItem>
              <DropdownMenuItem className="gap-2" onClick={() => setTheme("dark")}>
                <Moon size={14} /> Dark
              </DropdownMenuItem>
              <DropdownMenuItem className="gap-2" onClick={() => setTheme("system")}>
                <Monitor size={14} /> System
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => void logout()}
              >
                Log out
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
