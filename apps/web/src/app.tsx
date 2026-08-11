import { useEffect, useRef, useState, type MouseEvent } from "react";
import type { AppSnapshot } from "@tool-chenh/contracts";
import { SnapshotClient, type ConnectionState } from "./api/client.js";
import { DashboardPage } from "./pages/dashboard-page.js";
import { CategoryPage } from "./pages/category-page.js";
import { OpportunitiesPage } from "./pages/opportunities-page.js";
import { MappingsPage } from "./pages/mappings-page.js";
import { SessionsPage } from "./pages/sessions-page.js";
import { LiveCatalogPage } from "./pages/live-catalog-page.js";

type Route = "/" | "/football-live" | "/lol-live" | "/football" | "/lol" | "/opportunities" | "/mappings" | "/sessions";

const routes: ReadonlyArray<{ readonly path: Route; readonly label: string }> = [
  { path: "/", label: "Dashboard" },
  { path: "/football-live", label: "Football Live" },
  { path: "/lol-live", label: "LoL Live" },
  { path: "/football", label: "Football Overview" },
  { path: "/lol", label: "LoL Overview" },
  { path: "/opportunities", label: "Opportunities" },
  { path: "/mappings", label: "Mapping Review" },
  { path: "/sessions", label: "Sessions" }
];

function routeFor(pathname: string): Route {
  if (pathname === "/live-catalog") {
    try {
      return window.localStorage.getItem("tool-chenh.live-catalog.category.v1") === "LOL" ? "/lol-live" : "/football-live";
    } catch {
      return "/football-live";
    }
  }
  return routes.some((route) => route.path === pathname) ? pathname as Route : "/";
}

export function App({ initialSnapshot }: { readonly initialSnapshot?: AppSnapshot }) {
  const [snapshot, setSnapshot] = useState<AppSnapshot | undefined>(initialSnapshot);
  const [connectionState, setConnectionState] = useState<ConnectionState>(initialSnapshot === undefined ? "CONNECTING" : "LIVE");
  const [route, setRoute] = useState<Route>(() => routeFor(window.location.pathname));
  const mainRef = useRef<HTMLElement>(null);
  const routeLabel = routes.find((item) => item.path === route)?.label ?? "Dashboard";

  useEffect(() => {
    if (initialSnapshot !== undefined) return;
    const client = new SnapshotClient({ onSnapshot: setSnapshot, onConnectionState: setConnectionState });
    void client.start();
    return () => client.stop();
  }, [initialSnapshot]);

  useEffect(() => {
    if (window.location.pathname === "/live-catalog") window.history.replaceState({}, "", route);
  }, [route]);

  useEffect(() => {
    const onPopState = () => setRoute(routeFor(window.location.pathname));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    mainRef.current?.focus();
  }, [route]);

  const navigate = (path: Route) => (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    window.history.pushState({}, "", path);
    setRoute(path);
  };
  const content = route === "/sessions" ? <SessionsPage />
    : route === "/football-live" ? <LiveCatalogPage fixedCategory="FOOTBALL" key="FOOTBALL-LIVE" />
    : route === "/lol-live" ? <LiveCatalogPage fixedCategory="LOL" key="LOL-LIVE" />
    : snapshot === undefined
    ? <header className="page-header"><h1>Loading {routeLabel}</h1><p>Waiting for a fresh local snapshot. No opportunity or mapping decision is available yet.</p></header>
    : route === "/" ? <DashboardPage snapshot={snapshot} connectionState={connectionState} />
    : route === "/football" ? <CategoryPage key="FOOTBALL" category="FOOTBALL" snapshot={snapshot} />
    : route === "/lol" ? <CategoryPage key="LOL" category="LOL" snapshot={snapshot} />
    : route === "/opportunities" ? <OpportunitiesPage snapshot={snapshot} connectionState={connectionState} />
    : <MappingsPage snapshot={snapshot} connectionState={connectionState} />;

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">Skip to content</a>
      <nav aria-label="Primary navigation" className="primary-nav">
        <span className="brand">Fieldline</span>
        {routes.map((item) => <a aria-current={route === item.path ? "page" : undefined} href={item.path} key={item.path} onClick={navigate(item.path)}>{item.label}</a>)}
      </nav>
      <p className="visually-hidden" role="status" aria-live="polite">Now viewing {routeLabel}</p>
      <main id="main" ref={mainRef} tabIndex={-1}>{content}</main>
    </div>
  );
}
