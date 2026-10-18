"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BadgeDollarSign,
  ClipboardList,
  Menu,
  Package,
  PackageCheck,
  PackagePlus,
  PanelLeftClose,
  PanelLeftOpen,
  Shapes,
  ShoppingCart,
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
import { isNavActive, NAV_GROUPS, pageMetaFor, type PageMeta } from "@/lib/nav";

const STORAGE_KEY = "its.sidebar.collapsed";

const ICONS: Record<string, LucideIcon> = {
  "/": Package,
  "/taxonomies": Shapes,
  "/labels": Tag,
  "/sales/orders": ShoppingCart,
  "/purchasing/orders": ClipboardList,
  "/warehouse/pick": PackageCheck,
  "/warehouse/receiving": PackagePlus,
  "/pricing": BadgeDollarSign,
  "/admin/users": Users,
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

  const shellClass = [
    "app-shell",
    collapsed ? "collapsed" : "",
    drawerOpen ? "nav-open" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <ShellContext.Provider value={shellContext}>
      <div className={shellClass}>
        {drawerOpen ? (
          <button
            type="button"
            className="shell-backdrop"
            aria-label="Close menu"
            onClick={() => setDrawerOpen(false)}
          />
        ) : null}
        <aside className="sidebar no-print">
          <Link href="/items" className="brand" title="ITS">
            <span className="brand-mark">ITS</span>
          </Link>
          <nav className="sidebar-nav" aria-label="Main">
            {NAV_GROUPS.map((group) => (
              <div className="nav-group" key={group.label}>
                <div className="nav-group-label">{group.label}</div>
                {group.items.map((item) => {
                  const Icon = ICONS[item.href] ?? Package;
                  const active = isNavActive(item.href, pathname);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={active ? "nav-link active" : "nav-link"}
                      aria-current={active ? "page" : undefined}
                      title={item.label}
                      onClick={() => setDrawerOpen(false)}
                    >
                      <Icon size={18} strokeWidth={1.75} aria-hidden />
                      <span className="nav-label">{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>
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
