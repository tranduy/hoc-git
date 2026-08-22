import { useEffect, useRef, useState } from "react";
import type { AppSnapshot } from "@tool-chenh/contracts";
import { SnapshotClient, type CatalogRealtimeFeed, type ConnectionState } from "./api/client.js";
import { DashboardPage } from "./pages/dashboard-page.js";
import { CategoryPage } from "./pages/category-page.js";
import { OpportunitiesPage } from "./pages/opportunities-page.js";
import { MappingsPage } from "./pages/mappings-page.js";
import { SessionsPage } from "./pages/sessions-page.js";
import { LiveCatalogPage } from "./pages/live-catalog-page.js";
import { CatalogSourceApi } from "./api/catalog-sources.js";
import { BetHistoryPage } from "./pages/bet-history-page.js";
import { defaultTicketReportApi } from "./api/ticket-report.js";

type Route = "/" | "/football-live" | "/lol-live" | "/football" | "/lol" | "/opportunities" | "/mappings" | "/sessions" | "/bet-history";

const routes: ReadonlyArray<{ readonly path: Route; readonly label: string }> = [
  { path: "/football-live", label: "Football Live" },
  { path: "/lol-live", label: "LoL Live" },
  { path: "/football", label: "Football Overview" },
  { path: "/lol", label: "LoL Overview" },
  { path: "/opportunities", label: "Opportunities" },
  { path: "/mappings", label: "Mapping Review" },
  { path: "/sessions", label: "Sessions" },
  { path: "/bet-history", label: "Lịch sử vé" }
];

const catalogSourceApi = new CatalogSourceApi();
const freshnessApi = new CatalogSourceApi();

function routeFor(pathname: string): Route {
  if (pathname === "/") return "/football-live";
  if (pathname === "/live-catalog") {
    try {
      return window.localStorage.getItem("tool-chenh.live-catalog.category.v1") === "LOL" ? "/lol-live" : "/football-live";
    } catch {
      return "/football-live";
    }
  }
  return routes.some((route) => route.path === pathname) ? pathname as Route : "/football-live";
}

export function App({ initialSnapshot }: { readonly initialSnapshot?: AppSnapshot }) {
  const [snapshot, setSnapshot] = useState<AppSnapshot | undefined>(initialSnapshot);
  const [connectionState, setConnectionState] = useState<ConnectionState>(initialSnapshot === undefined ? "CONNECTING" : "LIVE");
  const [catalogBaseline, setCatalogBaseline] = useState<CatalogRealtimeFeed["baseline"]>(null);
  const [catalogRevision, setCatalogRevision] = useState<CatalogRealtimeFeed["revision"]>(null);
  const [route, setRoute] = useState<Route>(() => routeFor(window.location.pathname));
  const mainRef = useRef<HTMLElement>(null);
  const routeLabel = routes.find((item) => item.path === route)?.label ?? "Dashboard";

  useEffect(() => {
    const client = new SnapshotClient({ ...(initialSnapshot === undefined ? {} : { initialSnapshot }),
      onSnapshot: setSnapshot,
      onConnectionState: (state) => {
        setConnectionState(state);
        if (state !== "LIVE") {
          setCatalogBaseline(null);
          setCatalogRevision(null);
        }
      },
      onCatalogBaseline: (entries, sequence) => {
        setCatalogRevision(null);
        setCatalogBaseline({ entries, sequence });
      },
      onCatalogRevision: (entry, sequence) => setCatalogRevision({ entry, sequence }) });
    void client.start();
    return () => client.stop();
  }, [initialSnapshot]);

  const catalogRealtime: CatalogRealtimeFeed = {
    connectionState, baseline: catalogBaseline, revision: catalogRevision
  };

  useEffect(() => {
    if (window.location.pathname === "/live-catalog" || window.location.pathname === "/") {
      window.history.replaceState({}, "", route);
    }
  }, [route]);

  useEffect(() => {
    const onPopState = () => setRoute(routeFor(window.location.pathname));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    mainRef.current?.focus();
  }, [route]);

  const content = route === "/sessions" ? <SessionsPage />
    : route === "/bet-history" ? <BetHistoryPage />
    : route === "/football-live" ? <LiveCatalogPage catalogRealtime={catalogRealtime}
      catalogSourceApi={catalogSourceApi} freshnessApi={freshnessApi} fixedCategory="FOOTBALL" key="FOOTBALL-LIVE"
      ticketReportApi={defaultTicketReportApi} />
    : route === "/lol-live" ? <header className="page-header"><p className="eyebrow">League of Legends</p>
      <h1>LoL is temporarily disabled</h1><p>Football realtime detection is the only active data flow.</p></header>
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
      <p className="visually-hidden" role="status" aria-live="polite">Now viewing {routeLabel}</p>
      <main id="main" ref={mainRef} tabIndex={-1}>{content}</main>
    </div>
  );
}
