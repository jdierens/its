"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BadgeDollarSign,
  Boxes,
  Building,
  ClipboardList,
  Contact,
  Aperture,
  ArrowLeft,
  Menu,
  Package,
  Plug,
  PackageCheck,
  PackagePlus,
  ScanLine,
  Landmark,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Shapes,
  ShoppingCart,
  Store,
  Tag,
  Users,
  type LucideIcon,
} from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { revisionBeside, revisionTooltip } from "@/components/AppRevision";
import { ScanListener } from "@/components/ScanListener";
import { SignedInUser } from "@/components/SignedInUser";
import { fetchCurrentAppUser, type AppUser } from "@/lib/appUsers";
import { isNavActive, NAV_GROUPS, pageMetaFor, type PageMeta } from "@/lib/nav";
import { isPublicPath } from "@/lib/publicPaths";

const STORAGE_KEY = "its.sidebar.collapsed";

const ICONS: Record<string, LucideIcon> = {
  "/": Package,
  "/lens": Aperture,
  "/customers": Contact,
  "/vendors": Building,
  "/taxonomies": Shapes,
  "/labels": Tag,
  "/sales/orders": ShoppingCart,
  "/purchasing/orders": ClipboardList,
  "/warehouse/pick": PackageCheck,
  "/warehouse/receiving": PackagePlus,
  "/scan": ScanLine,
  "/warehouse/bins": Boxes,
  "/pricing": BadgeDollarSign,
  "/admin/users": Users,
  "/admin/settings": Settings,
  "/admin/integrations": Plug,
  "/admin/integrations/quickbooks": Landmark,
  "/admin/integrations/ebay": Store,
};

type ShellContextValue = {
  setOverride: (meta: PageMeta | null) => void;
};

const ShellContext = createContext<ShellContextValue | null>(null);

export function usePageMeta(meta: PageMeta | null) {
  const shell = useContext(ShellContext);
  const serialized = meta ? JSON.stringify(meta) : "";
  useEffect(() => {
    if (!shell) return;
    shell.setOverride(serialized ? (JSON.parse(serialized) as PageMeta) : null);
    return () => shell.setOverride(null);
  }, [shell, serialized]);
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [override, setOverrideState] = useState<PageMeta | null>(null);
  const [account, setAccount] = useState<AppUser | null>(null);
  const setOverride = useCallback((meta: PageMeta | null) => {
    setOverrideState(meta);
  }, []);
  const shellContext = useMemo(() => ({ setOverride }), [setOverride]);
  const fallback = useMemo(() => pageMetaFor(pathname), [pathname]);
  const meta = override ?? fallback;

  useEffect(() => {
    setCollapsed(window.localStorage.getItem(STORAGE_KEY) === "1");
  }, []);

  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!drawerOpen) return;
    function closeIfOutside(event: Event) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      const sidebar = document.querySelector(".sidebar");
      const toggle = document.querySelector(".nav-toggle");
      if (sidebar?.contains(target) || toggle?.contains(target)) return;
      event.preventDefault();
      setDrawerOpen(false);
    }
    document.addEventListener("pointerdown", closeIfOutside);
    document.addEventListener("touchstart", closeIfOutside, { passive: false });
    return () => {
      document.removeEventListener("pointerdown", closeIfOutside);
      document.removeEventListener("touchstart", closeIfOutside);
    };
  }, [drawerOpen]);

  useEffect(() => {
    if (isPublicPath(pathname) || pathname === "/login" || pathname === "/waiting") return;
    let cancelled = false;
    fetchCurrentAppUser()
      .then((user) => {
        if (!cancelled) setAccount(user);
      })
      .catch(() => {
        if (!cancelled) setAccount(null);
      });
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 860px)");
    const onChange = () => {
      if (!media.matches) setDrawerOpen(false);
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    document.body.style.overflow = drawerOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [drawerOpen]);

  function toggleCollapsed() {
    setCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      return next;
    });
  }

  // Legal pages, OAuth returns, and the sign-in screens render without the shell.
  if (isPublicPath(pathname) || pathname === "/login" || pathname === "/waiting") {
    return children;
  }

  const groups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => item.href !== "/admin/users" || account?.role === "admin"),
  })).filter((group) => group.items.length > 0);

  const shellClass = [
    "app-shell",
    collapsed ? "collapsed" : "",
    drawerOpen ? "nav-open" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <ShellContext.Provider value={shellContext}>
      <ScanListener />
      <div className={shellClass}>
        {drawerOpen ? (
          <button
            type="button"
            className="shell-backdrop"
            aria-label="Close menu"
            onPointerDown={(event) => {
              event.preventDefault();
              setDrawerOpen(false);
            }}
            onClick={() => setDrawerOpen(false)}
          />
        ) : null}
        <aside className="sidebar no-print">
          <div className="brand-block">
            <Link href="/items" className="brand" title={revisionTooltip}>
              <span className="brand-mark">ITS</span>
              <span className="brand-version">{revisionBeside}</span>
            </Link>
          </div>
          <nav className="sidebar-nav" aria-label="Main">
            {groups.map((group) => (
              <div className="nav-group" key={group.label}>
                <div className="nav-group-label">{group.label}</div>
                {group.items.map((item) => {
                  const Icon = ICONS[item.href] ?? Package;
                  const childActive = item.children?.some((child) => isNavActive(child.href, pathname)) ?? false;
                  const active = isNavActive(item.href, pathname) || childActive;
                  const current = pathname === item.href;
                  return (
                    <div key={item.href}>
                      <Link
                        href={item.href}
                        className={active ? "nav-link active" : "nav-link"}
                        aria-current={current ? "page" : undefined}
                        title={item.label}
                        onClick={() => setDrawerOpen(false)}
                      >
                        <Icon size={18} strokeWidth={1.75} aria-hidden />
                        <span className="nav-label">{item.label}</span>
                      </Link>
                      {item.children?.map((child) => {
                        const ChildIcon = ICONS[child.href] ?? Package;
                        const onChild = isNavActive(child.href, pathname);
                        return (
                          <Link
                            key={child.href}
                            href={child.href}
                            className={onChild ? "nav-link nav-child active" : "nav-link nav-child"}
                            aria-current={onChild ? "page" : undefined}
                            title={child.label}
                            onClick={() => setDrawerOpen(false)}
                          >
                            <ChildIcon size={16} strokeWidth={1.75} aria-hidden />
                            <span className="nav-label">{child.label}</span>
                          </Link>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            ))}
          </nav>
          <div className="sidebar-foot">
            <SignedInUser label={account?.name || account?.email || ""} />
            <div className="sidebar-legal">
              <Link href="/privacy" title="Privacy Policy">
                Privacy
              </Link>
              <Link href="/terms" title="Terms of Use">
                Terms
              </Link>
            </div>
            <button
              type="button"
              className="sidebar-collapse"
              aria-pressed={collapsed}
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              onClick={toggleCollapsed}
            >
              {collapsed ? (
                <PanelLeftOpen size={18} strokeWidth={1.75} aria-hidden />
              ) : (
                <PanelLeftClose size={18} strokeWidth={1.75} aria-hidden />
              )}
              <span className="nav-label">{collapsed ? "Expand" : "Collapse"}</span>
            </button>
          </div>
        </aside>
        <div className="shell-body">
          <header className="shell-top no-print">
            <button
              type="button"
              className="icon-button nav-toggle"
              aria-label="Open menu"
              aria-expanded={drawerOpen}
              onClick={() => setDrawerOpen(true)}
            >
              <Menu size={18} strokeWidth={1.75} aria-hidden />
            </button>
            {meta.backHref ? (
              <Link
                href={meta.backHref}
                className="icon-button back-link"
                aria-label={meta.backLabel || "Back"}
                title={meta.backLabel || "Back"}
              >
                <ArrowLeft size={18} strokeWidth={1.75} aria-hidden />
              </Link>
            ) : null}
            <div className="shell-heading">
              <nav aria-label="Breadcrumb">
                <ol className="crumbs">
                  {meta.crumbs.map((crumb, index) => {
                    const last = index === meta.crumbs.length - 1;
                    return (
                      <li key={`${crumb.label}-${index}`}>
                        {index > 0 ? <span className="crumb-sep">/</span> : null}
                        {crumb.href && !last ? (
                          <Link href={crumb.href}>{crumb.label}</Link>
                        ) : (
                          <span className={last ? "crumb-current" : undefined}>{crumb.label}</span>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </nav>
              <h1>{meta.title}</h1>
            </div>
          </header>
          <div className="shell-content">{children}</div>
        </div>
      </div>
    </ShellContext.Provider>
  );
}
