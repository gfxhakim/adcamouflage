/* eslint-disable @next/next/no-img-element -- small static brand PNG; the image optimizer adds nothing here. */
"use client";

import {
  Book1,
  Chart,
  DollarCircle,
  Element3,
  Gift,
  Headphone,
  Logout,
  Monitor,
  People,
  Setting2,
  Speedometer,
  type Icon,
} from "iconsax-reactjs";
import { Search, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import BrandLogo, { MARK_GLOW_ON_DARK } from "@/components/BrandLogo";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
  useSidebar,
} from "@/components/ui/sidebar";
import { searchAdmin, type AdminSearchEntry, type AdminTabId } from "@/lib/admin-search";
import { swallowSecondClick } from "@/lib/swallowSecondClick";

export interface AdminNavItem {
  id: AdminTabId;
  label: string;
  icon: Icon;
}

export const ADMIN_NAV: { title: string; items: AdminNavItem[] }[] = [
  {
    title: "Main menu",
    items: [
      { id: "overview", label: "Dashboard", icon: Speedometer },
      { id: "support", label: "Support · Live Chat", icon: Headphone },
      { id: "users", label: "Users", icon: People },
      { id: "sales", label: "Sales", icon: DollarCircle },
      { id: "affiliates", label: "Affiliates", icon: Gift },
      { id: "analytics", label: "Analytics", icon: Chart },
    ],
  },
  {
    title: "Site",
    items: [
      { id: "settings", label: "Settings", icon: Setting2 },
      { id: "landing", label: "Landing page", icon: Monitor },
      { id: "workspace", label: "Workspace", icon: Element3 },
      { id: "guides", label: "Guides (SEO)", icon: Book1 },
    ],
  },
];

export const ADMIN_TABS: AdminNavItem[] = ADMIN_NAV.flatMap((g) => g.items);

const ITEM_CLASS =
  "group/item flex h-10 w-full items-center justify-between rounded-lg px-3 text-slate-300 transition-all hover:bg-primary/10 hover:text-white data-[active=true]:bg-primary data-[active=true]:text-primary-foreground data-[active=true]:shadow-[0_0_18px_-4px_rgb(8_102_255/0.8)] data-[active=true]:hover:bg-primary/90 group-data-[collapsible=icon]:!size-10 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:!p-0";

const BRAND_MARK = "/brand/proteusflow-mark.png";

interface AdminSidebarProps {
  active: AdminTabId;
  onOpen: (id: AdminTabId) => void;
  /** Opens the page and scrolls to the setting with this title. */
  onJump: (entry: AdminSearchEntry) => void;
  supportBadge: number;
  name: string | null;
  email: string;
  onSignOut: () => void;
}

function initials(name: string | null, email: string): string {
  const source = (name || email).trim();
  const parts = source.split(/[\s._@-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "A") + (parts[1]?.[0] ?? "")).toUpperCase();
}

export default function AdminSidebar({ active, onOpen, onJump, supportBadge, name, email, onSignOut }: AdminSidebarProps) {
  const { isMobile, setOpenMobile, state, setOpen } = useSidebar();
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const pages = useMemo(() => (q ? ADMIN_TABS.filter((t) => t.label.toLowerCase().includes(q)) : []), [q]);
  const results = useMemo(() => searchAdmin(q), [q]);
  const collapsed = state === "collapsed" && !isMobile;

  // The search icon on the folded sidebar opens it and puts the cursor in the box.
  const searchBox = useRef<HTMLInputElement>(null);
  const [focusSearch, setFocusSearch] = useState(false);
  useEffect(() => {
    if (!focusSearch || collapsed) return;
    searchBox.current?.focus();
    setFocusSearch(false);
  }, [focusSearch, collapsed]);

  const closeDrawer = () => {
    if (isMobile) setOpenMobile(false);
  };
  // Picking a result turns the list back into the menu, and on phones closes the drawer: the
  // second click of a double click must not open whichever page (or button) comes up underneath.
  const open = (id: AdminTabId) => {
    if (query || isMobile) swallowSecondClick();
    onOpen(id);
    setQuery("");
    closeDrawer();
  };
  const jump = (entry: AdminSearchEntry) => {
    swallowSecondClick();
    onJump(entry);
    setQuery("");
    closeDrawer();
  };
  const tabLabel = (id: AdminTabId) => ADMIN_TABS.find((t) => t.id === id)?.label ?? id;

  return (
    <Sidebar collapsible="icon" className="border-sidebar-border">
      <SidebarHeader className="border-b border-border/60 px-5 py-4 group-data-[collapsible=icon]:px-2">
        <Link href="/" className="flex min-w-0 items-center group-data-[collapsible=icon]:hidden" aria-label="ProteusFlow home">
          <BrandLogo caption="Admin · Command deck" onDark />
        </Link>
        {collapsed ? (
          <>
            <Link href="/" title="ProteusFlow" className="mx-auto grid size-10 place-items-center rounded-lg hover:bg-primary/10">
              <img src={BRAND_MARK} alt="ProteusFlow" width={28} height={28} className={`h-7 w-7 object-contain ${MARK_GLOW_ON_DARK}`} />
            </Link>
            <button
              type="button"
              onClick={() => {
                setOpen(true);
                setFocusSearch(true);
              }}
              className="mx-auto grid size-10 place-items-center rounded-lg text-slate-400 hover:bg-primary/10 hover:text-white"
              aria-label="Search settings"
              title="Search settings"
            >
              <Search className="size-4" aria-hidden />
            </button>
          </>
        ) : (
          <div className="relative mt-3 w-full">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
            <Input
              ref={searchBox}
              value={query}
              onChange={(ev) => setQuery(ev.target.value)}
              onKeyDown={(ev) => {
                if (ev.key === "Escape") setQuery("");
                // Enter opens the first row of the list below, and pages are listed first.
                if (ev.key === "Enter") {
                  if (pages[0]) open(pages[0].id);
                  else if (results[0]) jump(results[0]);
                }
              }}
              placeholder="Search settings..."
              aria-label="Search any setting by its title"
              className="h-9 border-border bg-background/60 pl-9 pr-8 text-slate-100 shadow-none hover:bg-background focus:bg-background"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute right-2 top-2 grid size-5 place-items-center rounded text-muted-foreground hover:text-white"
                aria-label="Clear search"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            ) : null}
          </div>
        )}
      </SidebarHeader>

      <SidebarContent className="px-3 py-3 group-data-[collapsible=icon]:px-2">
        {q && !collapsed ? (
          <SidebarGroup className="p-0">
            <SidebarGroupLabel className="px-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              {pages.length + results.length > 0 ? "Results" : "Nothing found"}
            </SidebarGroupLabel>
            <SidebarGroupContent className="mt-1">
              <SidebarMenu className="gap-1">
                {pages.map((item) => (
                  <SidebarMenuItem key={`page-${item.id}`}>
                    <SidebarMenuButton onClick={() => open(item.id)} className={ITEM_CLASS}>
                      <div className="flex min-w-0 items-center gap-3">
                        <item.icon className="size-5 shrink-0" variant="Linear" />
                        <span className="truncate font-medium">{item.label}</span>
                      </div>
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Page</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
                {results.map((entry) => (
                  <SidebarMenuItem key={`${entry.tab}-${entry.title}`}>
                    <SidebarMenuButton
                      onClick={() => jump(entry)}
                      className="flex h-auto w-full flex-col items-start gap-0.5 rounded-lg px-3 py-2 text-slate-200 hover:bg-primary/10 hover:text-white"
                    >
                      <span className="w-full whitespace-normal text-left text-sm font-medium leading-snug">{entry.title}</span>
                      <span className="text-[11px] text-muted-foreground">in {tabLabel(entry.tab)}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
              {pages.length + results.length === 0 ? (
                <p className="px-2 py-2 text-xs text-muted-foreground">
                  No setting has &ldquo;{query.trim()}&rdquo; in its title. Try one word, like &ldquo;price&rdquo; or &ldquo;email&rdquo;.
                </p>
              ) : null}
            </SidebarGroupContent>
          </SidebarGroup>
        ) : (
          ADMIN_NAV.map((group, index) => (
            <SidebarGroup key={group.title} className={index > 0 ? "mt-4 p-0" : "p-0"}>
              <SidebarGroupLabel className="px-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                {group.title}
              </SidebarGroupLabel>
              <SidebarGroupContent className="mt-1">
                <SidebarMenu className="gap-1.5">
                  {group.items.map((item) => {
                    const isActive = active === item.id;
                    const badge = item.id === "support" && supportBadge > 0 ? supportBadge : null;
                    return (
                      <SidebarMenuItem key={item.id}>
                        <SidebarMenuButton
                          isActive={isActive}
                          tooltip={item.label}
                          aria-current={isActive ? "page" : undefined}
                          onClick={() => open(item.id)}
                          className={ITEM_CLASS}
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <item.icon
                              className="size-5 shrink-0 transition-transform group-hover/item:scale-110"
                              variant={isActive ? "Bulk" : "Linear"}
                            />
                            <span className="truncate font-medium group-data-[collapsible=icon]:sr-only">{item.label}</span>
                          </div>
                          {badge ? (
                            <Badge className="ml-auto h-5 border-transparent bg-amber-400 px-1.5 font-mono text-[10px] text-slate-950 hover:bg-amber-400 group-data-[collapsible=icon]:hidden">
                              {badge}
                            </Badge>
                          ) : null}
                        </SidebarMenuButton>
                        {badge ? (
                          <span className="pointer-events-none absolute -right-0.5 -top-0.5 hidden size-2.5 rounded-full bg-amber-400 group-data-[collapsible=icon]:block" />
                        ) : null}
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))
        )}
      </SidebarContent>

      <SidebarFooter className="gap-1.5 border-t border-border/60 p-3 group-data-[collapsible=icon]:p-2">
        <div className="flex w-full items-center gap-3 rounded-lg p-1.5 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0.5">
          <Avatar className="h-9 w-9">
            <AvatarFallback className="bg-primary/20 text-xs font-bold text-meta-200">{initials(name, email)}</AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-1 flex-col group-data-[collapsible=icon]:hidden">
            <span className="truncate text-sm font-semibold text-slate-100">{name || "Admin"}</span>
            <span className="truncate text-xs text-muted-foreground">{email}</span>
          </div>
        </div>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={onSignOut}
              tooltip="Sign out"
              className="group/item flex h-10 w-full items-center gap-3 rounded-lg px-3 text-rose-300/80 transition-all hover:bg-rose-500/15 hover:text-rose-200 active:bg-rose-500/25 active:text-rose-100 group-data-[collapsible=icon]:!size-10 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:!p-0"
            >
              <Logout className="!size-5 shrink-0" variant="Linear" />
              <span className="truncate font-medium group-data-[collapsible=icon]:sr-only">Sign out</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
