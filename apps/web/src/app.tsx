import { useEffect, useState } from "react";
import type { AppSnapshot } from "@tool-chenh/contracts";
import { SnapshotClient, type ConnectionState } from "./api/client.js";
import { DashboardPage } from "./pages/dashboard-page.js";
import { CategoryPage } from "./pages/category-page.js";

type Route = "/" | "/football" | "/lol" | "/opportunities" | "/mappings";

const routes: ReadonlyArray<{ readonly path: Route; readonly label: string }> = [
  { path: "/", label: "Dashboard" },
  { path: "/football", label: "Football" },
  { path: "/lol", label: "LoL" },
  { path: "/opportunities", label: "Opportunities" },
  { path: "/mappings", label: "Mapping Review" }
];

function routeFor(pathname: string): Route {
  return routes.some((route) => route.path === pathname) ? pathname as Route : "/";
}

function PlaceholderPage({ title, detail }: { readonly title: string; readonly detail: string }) {
  return <header className="page-header"><p className="eyebrow">Read-only inspection</p><h1>{title}</h1><p>{detail}</p></header>;
}

export function App({ initialSnapshot }: { readonly initialSnapshot?: AppSnapshot }) {
  const [snapshot, setSnapshot] = useState<AppSnapshot | undefined>(initialSnapshot);
  const [connectionState, setConnectionState] = useState<ConnectionState>(initialSnapshot === undefined ? "CONNECTING" : "LIVE");
  const [route, setRoute] = useState<Route>(() => routeFor(window.location.pathname));

  useEffect(() => {
    if (initialSnapshot !== undefined) return;
    const client = new SnapshotClient({ onSnapshot: setSnapshot, onConnectionState: setConnectionState });
    void client.start();
    return () => client.stop();
  }, [initialSnapshot]);

  const navigate = (path: Route) => (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    window.history.pushState({}, "", path);
    setRoute(path);
  };
  const content = snapshot === undefined
    ? <header className="page-header"><h1>Loading dashboard</h1><p>Waiting for a fresh local snapshot.</p></header>
    : route === "/" ? <DashboardPage snapshot={snapshot} connectionState={connectionState} />
    : route === "/football" ? <CategoryPage category="FOOTBALL" snapshot={snapshot} />
    : route === "/lol" ? <CategoryPage category="LOL" snapshot={snapshot} />
    : route === "/opportunities" ? <PlaceholderPage title="Opportunities" detail="Opportunity details are read-only and arrive in the next view." />
    : <PlaceholderPage title="Mapping Review" detail="Mapping evidence inspection arrives in the next view." />;

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">Skip to content</a>
      <nav aria-label="Primary navigation" className="primary-nav">
        <span className="brand">Fieldline</span>
        {routes.map((item) => <a aria-current={route === item.path ? "page" : undefined} href={item.path} key={item.path} onClick={navigate(item.path)}>{item.label}</a>)}
      </nav>
      <main id="main">{content}</main>
    </div>
  );
}
