import { useState } from "react";
import { useSnapshot } from "./api";
import { MachinesPage } from "./pages/MachinesPage";
import { PolicyPage } from "./pages/PolicyPage";
import { EventsPage, PairingPage, PasswordPage } from "./pages/SettingsPages";
import { t } from "./strings";

type Tab = keyof typeof t.tabs;
const TABS: readonly Tab[] = ["machines", "allowList", "password", "pairing", "events"];

export function App() {
  const snapshot = useSnapshot();
  const [tab, setTab] = useState<Tab>("machines");
  if (snapshot === null) return <main className="loading">…</main>;

  const { server } = snapshot;
  return (
    <div className="app">
      <header>
        <h1>{t.appTitle}</h1>
        <div className={server.listening ? "ok" : "error"}>
          {server.listening ? t.server.listening(server.port) : `${t.server.stopped}${server.error === null ? "" : `: ${server.error}`}`}
          {server.fingerprint !== null && (
            <div className="muted small" title={server.fingerprint}>
              {t.server.fingerprint}: {server.fingerprint.slice(0, 16)}…
            </div>
          )}
        </div>
      </header>
      <nav>
        {TABS.map((name) => (
          <button key={name} className={tab === name ? "active" : ""} onClick={() => setTab(name)}>
            {t.tabs[name]}
            {name === "password" && !snapshot.password.set && " ⚠"}
          </button>
        ))}
      </nav>
      <main>
        {tab === "machines" && <MachinesPage snapshot={snapshot} />}
        {tab === "allowList" && <PolicyPage key={snapshot.policy.version} policy={snapshot.policy} />}
        {tab === "password" && <PasswordPage snapshot={snapshot} />}
        {tab === "pairing" && <PairingPage snapshot={snapshot} />}
        {tab === "events" && <EventsPage events={snapshot.events} />}
      </main>
    </div>
  );
}
