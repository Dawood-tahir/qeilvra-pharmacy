"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LayoutDashboard, ShoppingCart, Pill, Boxes, Truck, ContactRound, BarChart3,
  WalletCards, Users, Settings, Bell, Search, X, LogOut,
  AlertTriangle, MoreHorizontal, RotateCcw, Menu,
  ScrollText, ReceiptText,
} from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { DialogLoading } from "@/components/ui/dialog-loading";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { cn, getInitials } from "@/lib/utils";
import type { StaffUser } from "@/lib/auth";

type NavItem = { label: string; href: string; icon: typeof LayoutDashboard };
const GlobalSearch = lazy(() => import("@/components/global-search").then(module => ({ default: module.GlobalSearch })));

const ownerNav: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "POS / Sales", href: "/pos", icon: ShoppingCart },
  { label: "Inventory", href: "/medicines", icon: Pill },
  { label: "Invoices", href: "/sales", icon: ReceiptText },
  { label: "Returns", href: "/returns", icon: RotateCcw },
  { label: "Stock History", href: "/stock", icon: Boxes },
  { label: "Purchases", href: "/purchases", icon: Truck },
  { label: "Suppliers", href: "/suppliers", icon: ContactRound },
  { label: "Reports", href: "/reports", icon: BarChart3 },
  { label: "Expenses", href: "/expenses", icon: WalletCards },
  { label: "Salespeople", href: "/users", icon: Users },
  { label: "Settings", href: "/settings", icon: Settings },
  { label: "Audit Log", href: "/audit", icon: ScrollText },
];

const salespersonNav: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "POS / Sales", href: "/pos", icon: ShoppingCart },
  { label: "Inventory", href: "/medicines", icon: Pill },
  { label: "Stock Alerts", href: "/alerts", icon: AlertTriangle },
  { label: "My Invoices", href: "/sales", icon: ReceiptText },
  { label: "My Returns", href: "/returns", icon: RotateCcw },
  { label: "Settings", href: "/profile", icon: Settings },
];

export function AppShell({ staff, children }: { staff: StaffUser; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [searchOpen, setSearchOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const drawerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeDrawer = useCallback(() => {
    setClosing(true);
    drawerTimer.current = setTimeout(() => { setMobileOpen(false); setClosing(false); }, 160);
  }, []);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) { try { setCollapsed(localStorage.getItem("qeilvra-sidebar") === "collapsed"); } catch {} } });
    const desktop = window.matchMedia("(min-width: 1024px)");
    const onResize = () => { if (desktop.matches) { setMobileOpen(false); setClosing(false); } };
    desktop.addEventListener("change", onResize);
    return () => { active = false; desktop.removeEventListener("change", onResize); if (drawerTimer.current) clearTimeout(drawerTimer.current); };
  }, []);
  function toggleSidebar() {
    setCollapsed((value) => { try { localStorage.setItem("qeilvra-sidebar", value ? "expanded" : "collapsed"); } catch {} return !value; });
  }

  const nav = staff.role === "owner" ? ownerNav : salespersonNav;

  const isActive = useCallback((href: string) => pathname === href || (href !== "/dashboard" && pathname.startsWith(`${href}/`)), [pathname]);
  const mobilePrimary = useMemo(() => [
    { label: "Home", href: "/dashboard", icon: LayoutDashboard },
    { label: "POS", href: "/pos", icon: ShoppingCart },
    { label: "Inventory", href: "/medicines", icon: Pill },
    { label: "Alerts", href: "/alerts", icon: AlertTriangle },
  ], []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setSearchOpen(true); }
      if (!typing && event.key === "F2") { event.preventDefault(); router.push("/pos"); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [router]);

  return (
    <div className={cn("min-h-screen transition-[grid-template-columns] duration-200 motion-reduce:transition-none lg:grid print:block print:min-h-0", collapsed ? "lg:grid-cols-[80px_minmax(0,1fr)]" : "lg:grid-cols-[224px_minmax(0,1fr)] xl:grid-cols-[260px_minmax(0,1fr)]")}>
      <a href="#main-content" className="no-print fixed left-4 top-2 z-[100] -translate-y-24 rounded-xl bg-white px-4 py-3 text-sm font-bold text-blue-800 shadow-lg focus:translate-y-0">Skip to content</a>
      <aside id="desktop-sidebar" className={cn("q-navigation no-print fixed inset-y-0 left-0 z-40 hidden flex-col overflow-hidden text-white transition-[width] duration-200 motion-reduce:transition-none lg:flex", collapsed ? "w-20" : "w-[224px] xl:w-[260px]")}>
        <div className={cn("p-3", collapsed && "flex flex-col items-center")}><Button variant="ghost" size="icon" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-controls="desktop-sidebar" aria-expanded={!collapsed} onClick={toggleSidebar} className="text-white hover:bg-white/10 hover:text-white"><Menu /></Button><div className={collapsed ? "py-3" : "px-3 py-3"}><BrandMark light compact={collapsed} /></div></div>
        <nav className="scrollbar-thin flex-1 space-y-1 overflow-y-auto px-3 py-2" aria-label="Primary navigation">
          {nav.map(({ href, label, icon: Icon }) => (
            <Link prefetch={pathname === "/pos" ? false : null} key={href} href={href} title={collapsed ? label : undefined} aria-label={label} aria-current={isActive(href) ? "page" : undefined} className={cn("q-nav-link flex h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium text-blue-100 transition hover:bg-white/10 hover:text-white", collapsed && "justify-center px-0")}>
              <Icon className="size-5 shrink-0" /><span className={collapsed ? "sr-only" : undefined}>{label}</span>
            </Link>
          ))}
        </nav>
        <p className={cn("mx-4 mb-2 mt-3 border-t border-white/10 pt-3 text-[10px] text-blue-200", collapsed && "hidden")}>Secure pharmacy operations</p>
        <form action="/auth/signout" method="post" className="px-4 pb-4"><Button variant="ghost" aria-label="Sign out" title={collapsed ? "Sign out" : undefined} className={cn("w-full justify-start text-white hover:bg-white/10 hover:text-white", collapsed && "justify-center px-0")}><LogOut /><span className={collapsed ? "sr-only" : undefined}>Sign out</span></Button></form>
      </aside>

      <div className="min-w-0 lg:col-start-2">
        <header className="q-topbar no-print sticky top-0 z-30 border-b border-slate-200/80">
          <div className="flex h-16 items-center gap-3 px-4 sm:px-6 lg:h-[72px] lg:px-8">
            <Button variant="ghost" size="icon" className="shrink-0 lg:hidden" aria-label="Open navigation menu" aria-expanded={mobileOpen} aria-controls="mobile-sidebar" onClick={() => { setClosing(false); setMobileOpen(true); }}><Menu /></Button><div className="lg:hidden"><BrandMark compact /></div>
            <button onClick={() => setSearchOpen(true)} className="hidden h-11 max-w-xl flex-1 items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 text-left text-sm text-slate-500 hover:border-blue-300 hover:bg-white sm:flex">
              <Search className="size-4" /><span className="truncate">Search medicines, invoices…</span><kbd className="ml-auto rounded border bg-white px-2 py-0.5 text-[10px] text-slate-400">Ctrl K</kbd>
            </button>
            <button onClick={() => setSearchOpen(true)} className="ml-auto grid size-10 place-items-center rounded-xl text-slate-600 hover:bg-slate-100 sm:hidden" aria-label="Search"><Search /></button>
            <Link prefetch={pathname === "/pos" ? false : null} href="/notifications" className="relative grid size-10 place-items-center rounded-xl text-slate-600 hover:bg-slate-100" aria-label="Notifications"><Bell className="size-5" /></Link>
            <div className="hidden h-8 w-px bg-slate-200 sm:block" />
            <div className="flex items-center gap-2">
              <span className="grid size-9 place-items-center rounded-full bg-blue-600 text-xs font-bold text-white">{getInitials(staff.fullName)}</span>
              <span className="hidden sm:block"><span className="block max-w-32 truncate text-sm font-bold text-slate-900">{staff.fullName}</span><span className="block text-[11px] capitalize text-slate-500">{staff.role}</span></span>
            </div>
          </div>
        </header>

        <div id="main-content" tabIndex={-1} className="min-h-[calc(100vh-4rem)] scroll-mt-20 pb-24 outline-none lg:pb-0">{children}</div>
        <footer className="hidden border-t border-slate-200 bg-white px-8 py-5 text-xs text-slate-500 lg:flex lg:items-center lg:justify-between">
          <span>© {new Date().getFullYear()} Qeilvra. All rights reserved.</span><span>Pharmacy Management System</span>
        </footer>
      </div>

      <nav className="q-mobile-nav no-print safe-bottom fixed inset-x-0 bottom-0 z-50 grid grid-cols-5 border-t border-slate-200 px-1 pt-2 shadow-[0_-8px_25px_rgba(15,23,42,.08)] lg:hidden" aria-label="Mobile navigation">
        {mobilePrimary.map(({ href, label, icon: Icon }) => {
          const allowed = nav.some((item) => item.href === href) || href === "/alerts";
          if (!allowed) return null;
          return <Link prefetch={pathname === "/pos" ? false : null} key={href} href={href} aria-current={isActive(href) ? "page" : undefined} className={cn("flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl text-[10px] font-semibold text-slate-500", isActive(href) && "bg-blue-50 text-blue-800")}><Icon className="size-5" /><span>{label}</span></Link>;
        })}
        <button onClick={() => setMoreOpen(true)} className="flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl text-[10px] font-semibold text-slate-500"><MoreHorizontal className="size-5" /><span>More</span></button>
      </nav>

      {moreOpen && <Dialog label="More tools" onClose={() => setMoreOpen(false)}>
        <div className="safe-bottom">
          <div className="mb-4 flex items-center justify-between"><div><p className="font-bold">More</p><p className="text-xs text-slate-500">{staff.role === "owner" ? "Owner tools" : "Your workspace"}</p></div><Button variant="ghost" size="icon" onClick={() => setMoreOpen(false)} aria-label="Close"><X /></Button></div>
          <div className="grid grid-cols-2 gap-2">
            {nav.filter((item) => !mobilePrimary.some((mobile) => mobile.href === item.href)).map(({ href, label, icon: Icon }) => <Link prefetch={pathname === "/pos" ? false : null} key={href} href={href} onClick={() => setMoreOpen(false)} className="flex min-h-16 items-center gap-3 rounded-2xl border border-slate-200 p-3 font-semibold text-slate-700"><span className="grid size-10 place-items-center rounded-xl bg-blue-50 text-blue-700"><Icon /></span><span className="text-sm">{label}</span></Link>)}
          </div>
          <form action="/auth/signout" method="post" className="mt-3"><Button variant="outline" className="w-full text-red-600"><LogOut /> Sign out</Button></form>
        </div>
      </Dialog>}
      {mobileOpen && <Dialog label="Navigation menu" onClose={closeDrawer} busy={closing} className={cn("q-navigation inset-y-0 left-0 right-auto m-0 flex h-dvh max-h-dvh w-[min(300px,85vw)] max-w-none flex-col rounded-none p-3 text-white sm:p-3", closing ? "sidebar-closing" : "sidebar-opening")}>
        <div id="mobile-sidebar" className="flex h-full min-h-0 flex-col">
          <div className="flex items-center gap-3 pb-4"><Button variant="ghost" size="icon" aria-label="Close navigation menu" onClick={closeDrawer} className="shrink-0 text-white hover:bg-white/10 hover:text-white"><Menu /></Button><BrandMark light /></div>
          <nav aria-label="Mobile sidebar navigation" className="scrollbar-thin min-h-0 flex-1 space-y-1 overflow-y-auto">
            {nav.map(({ href, label, icon: Icon }) => <Link key={href} href={href} prefetch={pathname === "/pos" ? false : null} aria-current={isActive(href) ? "page" : undefined} onClick={() => { setMobileOpen(false); setClosing(false); }} className="q-nav-link flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm text-blue-100 hover:bg-white/10"><Icon className="size-5 shrink-0" />{label}</Link>)}
          </nav>
          <form action="/auth/signout" method="post" className="pt-4"><Button variant="ghost" className="w-full justify-start text-white hover:bg-white/10 hover:text-white"><LogOut /> Sign out</Button></form>
        </div>
      </Dialog>}
      {searchOpen && <Suspense fallback={<DialogLoading label="Global search" onClose={() => setSearchOpen(false)} />}><GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} /></Suspense>}
    </div>
  );
}
