"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Smartphone,
  Inbox,
  Contact,
  MessageSquare,
  Webhook,
  Code,
  Settings,
  Send,
  Workflow,
  Users,
  Sparkles,
  Plug,
  ExternalLink,
  BookOpen,
  ShieldCheck,
  FolderKanban,
} from "lucide-react";
import { WorkspaceSwitcher } from "@/components/workspaces/workspace-switcher";
import { useWorkspace } from "@/components/workspaces/workspace-provider";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
  useSidebar,
} from "@/components/ui/sidebar";

// `cap` → the workspace capability required to see this item (see
// dashboard-api/src/lib/capabilities.ts). `always` items are visible to every
// member; `adminOnly` items are OWNER/ADMIN only. Owners/admins have every
// capability, so they see everything.
type NavDefinition = {
  label: string;
  href: string;
  icon: React.ElementType;
  cap?: string | string[];
  always?: boolean;
  adminOnly?: boolean;
};

const NAV_ITEMS: NavDefinition[] = [
  { label: "Overview", href: "/dashboard/overview", icon: LayoutDashboard, always: true },
  { label: "Sessions", href: "/dashboard/sessions", icon: Smartphone, cap: ["sessions", "sessions_create"] },
  { label: "Inbox", href: "/dashboard/inbox", icon: Inbox, cap: "inbox" },
  { label: "Projects", href: "/dashboard/projects", icon: FolderKanban, cap: "projects" },
  { label: "Contacts", href: "/dashboard/contacts", icon: Contact, cap: "contacts" },
  { label: "Messages", href: "/dashboard/messages", icon: MessageSquare, cap: "messages" },
  { label: "Webhooks", href: "/dashboard/webhooks", icon: Webhook, cap: "webhooks" },
  { label: "Team", href: "/dashboard/team", icon: Users, adminOnly: true },
  { label: "Developer", href: "/dashboard/developer", icon: Code, cap: "api_keys" },
  { label: "Settings", href: "/dashboard/settings", icon: Settings, cap: "settings" },
];

const PRO_ITEMS: NavDefinition[] = [
  { label: "Campaigns", href: "/dashboard/campaigns", icon: Send, cap: "messages" },
  { label: "Automations", href: "/dashboard/automations", icon: Workflow, cap: "messages" },
  { label: "CRM", href: "/dashboard/crm", icon: Users, cap: "contacts" },
  { label: "AI Replies", href: "/dashboard/ai-replies", icon: Sparkles, cap: "inbox" },
  { label: "WHMCS", href: "/dashboard/whmcs", icon: Plug, cap: "messages" },
];

function NavItem({
  label,
  href,
  icon: Icon,
  active,
  collapsed,
}: {
  label: string;
  href: string;
  icon: React.ElementType;
  active: boolean;
  collapsed: boolean;
}) {
  const { isMobile, setOpenMobile } = useSidebar();
  return (
    <SidebarMenuItem className="mb-0.5">
      <SidebarMenuButton
        render={<Link href={href} onClick={() => { if (isMobile) setOpenMobile(false); }} />}
        isActive={active}
        tooltip={label}
        className={[
          collapsed
            ? "flex-col justify-center gap-1 h-auto py-2"
            : "flex-row gap-2",
          // active: dark bg + black/white text, bold
          "data-active:!bg-primary/10 data-active:!text-primary dark:data-active:!bg-primary/15 dark:data-active:!text-primary data-active:!font-semibold",
        ].join(" ")}
      >
        <Icon className="shrink-0" size={18} />
        <span
          className={
            collapsed
              ? "text-[10px] text-center leading-none"
              : "text-sm leading-none"
          }
        >
          {label}
        </span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function ExternalNavItem({
  label,
  href,
  icon: Icon,
  collapsed,
  disabled,
  disabledReason,
}: {
  label: string;
  href: string | null;
  icon: React.ElementType;
  collapsed: boolean;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const inner = (
    <SidebarMenuButton
      disabled={disabled}
      tooltip={disabled ? disabledReason : label}
      className={[
        collapsed ? "flex-col justify-center gap-1 h-auto py-2" : "flex-row gap-2",
        disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer",
      ].join(" ")}
    >
      <Icon className="shrink-0" size={18} />
      <span className={collapsed ? "text-[10px] text-center leading-none" : "text-sm leading-none flex-1"}>
        {label}
      </span>
      {!collapsed && !disabled && <ExternalLink size={12} className="shrink-0 ml-auto opacity-50" />}
    </SidebarMenuButton>
  );

  if (disabled || !href) return <SidebarMenuItem className="mb-0.5">{inner}</SidebarMenuItem>;

  return (
    <SidebarMenuItem className="mb-0.5">
      <a href={href} target="_blank" rel="noopener noreferrer" className="w-full">
        {inner}
      </a>
    </SidebarMenuItem>
  );
}

export function AppSidebar({ demoMode = false }: { demoMode?: boolean }) {
  const pathname = usePathname();
  const { state, isMobile } = useSidebar();
  const { selectedWorkspaceId } = useWorkspace();

  // Nav visibility is driven by the member's effective capabilities. Owners and
  // admins get everything; agents see Inbox/Contacts plus whatever they've been
  // granted. Until the role loads, show only the always-visible items to avoid a
  // flash of links an agent can't use.
  const [role, setRole] = React.useState<string | null>(null);
  const [caps, setCaps] = React.useState<string[] | null>(null);
  React.useEffect(() => {
    setRole(null);
    setCaps(null);
    fetch("/api/team/my-role")
      .then((r) => r.json())
      .then((d) => { setRole(d?.role ?? null); setCaps(Array.isArray(d?.capabilities) ? d.capabilities : null); })
      .catch(() => {});
  }, [demoMode, selectedWorkspaceId]);
  // In demo mode there's no auth/role backend, so /api/team/my-role never
  // resolves a role — treat the demo viewer as a manager so the full Core
  // sidebar (Sessions, Inbox, Contacts, Messages, Webhooks, Team, Developer,
  // Settings) is showcased instead of collapsing to just Overview.
  const isManager = demoMode || role === "OWNER" || role === "ADMIN";
  const canSee = (i: NavDefinition) => {
    if (i.always) return true;
    if (i.adminOnly) return isManager;
    if (isManager) return true;
    if (caps === null) return false; // still loading — hide gated items
    if (!i.cap) return false;
    return (Array.isArray(i.cap) ? i.cap : [i.cap]).some((capability) => caps.includes(capability));
  };
  const navItems = NAV_ITEMS.filter(canSee);
  const proItems = PRO_ITEMS.filter(canSee);
  // On mobile the sidebar is a full drawer — never icon-collapse it.
  const collapsed = !isMobile && state === "collapsed";

  // The dashboard proxy forwards these paths to each service's real /api/reference endpoint.
  const docsBase = demoMode ? "https://app.wasphere.com" : "";
  const waDocsHref = `${docsBase}/docs/wa-server/api/reference`;
  const adminDocsHref = `${docsBase}/docs/admin/api/reference`;

  // Custom workspace logo (branding). Falls back to the WaSphere wordmark.
  const [logo, setLogo] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (demoMode) return;
    let active = true;
    fetch("/api/settings/workspace")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (active) setLogo(typeof d?.logo === "string" ? d.logo : null); })
      .catch(() => {});
    return () => { active = false; };
  }, [demoMode, selectedWorkspaceId]);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="gap-2 px-3 py-3">
        {logo ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={logo}
            alt="Logo"
            className={collapsed ? "h-7 w-7 object-contain mx-auto" : "h-7 max-w-[150px] object-contain"}
          />
        ) : collapsed ? (
          <span className="text-primary font-bold text-lg flex justify-center">W</span>
        ) : (
          <span className="text-primary font-bold text-lg tracking-tight">WaSphere</span>
        )}
        <WorkspaceSwitcher demoMode={demoMode} />
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map(({ label, href, icon }) => {
                const active =
                  pathname === href || pathname.startsWith(href + "/");
                return (
                  <NavItem
                    key={href}
                    label={label}
                    href={href}
                    icon={icon}
                    active={active}
                    collapsed={collapsed}
                  />
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarSeparator />

        <SidebarGroup>
          {!collapsed && (
            <SidebarGroupLabel className="text-muted-foreground/60 text-xs uppercase tracking-wider px-2 mb-1">
              API Docs
            </SidebarGroupLabel>
          )}
          <SidebarGroupContent>
            <SidebarMenu>
              <ExternalNavItem
                label="WhatsApp API"
                href={waDocsHref}
                icon={BookOpen}
                collapsed={collapsed}
              />
              <ExternalNavItem
                label="Admin API"
                href={adminDocsHref}
                icon={ShieldCheck}
                collapsed={collapsed}
              />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {proItems.length > 0 && (
          <>
            <SidebarSeparator />

            <SidebarGroup>
              {!collapsed && (
                <SidebarGroupLabel className="text-muted-foreground/60 text-xs uppercase tracking-wider px-2 mb-1">
                  Pro
                </SidebarGroupLabel>
              )}
              <SidebarGroupContent>
                <SidebarMenu>
                  {proItems.map(({ label, href, icon }) => (
                    <NavItem
                      key={href}
                      label={label}
                      href={href}
                      icon={icon}
                      active={pathname === href || pathname.startsWith(href + "/")}
                      collapsed={collapsed}
                    />
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </>
        )}
      </SidebarContent>

      <SidebarFooter />
    </Sidebar>
  );
}
