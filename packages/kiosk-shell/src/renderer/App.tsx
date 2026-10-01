import { useState } from "react";
import { useHotkey, useKioskView, useNow } from "./api";
import { Launcher, LockedScreen, MaintenanceScreen, PasswordPanel } from "./screens";

// What the visitor sees depends ONLY on what the agent says:
//   agent unreachable -> locked page (+ "service not running")
//   LOCKED            -> locked page
//   UNLOCKED          -> launcher with countdown
//   MAINTENANCE       -> "restarting" page
// The launcher is never shown without the agent's say-so.

export function App() {
  const view = useKioskView();
  const now = useNow();
  const [panelOpen, setPanelOpen] = useState(false);
  const state = view.state;
  useHotkey(() => setPanelOpen(state?.lock !== "MAINTENANCE"));

  const elapsedSec = Math.max(0, Math.floor((now - view.receivedAt) / 1000));
  const remainingSec = Math.max(0, (state?.remainingSec ?? 0) - elapsedSec);

  let screen;
  if (state === null) screen = <LockedScreen serviceDown />;
  else if (state.lock === "UNLOCKED") screen = <Launcher state={state} remainingSec={remainingSec} />;
  else if (state.lock === "MAINTENANCE") screen = <MaintenanceScreen />;
  else screen = <LockedScreen serviceDown={false} />;

  return (
    <>
      {screen}
      {panelOpen && <PasswordPanel onClose={() => setPanelOpen(false)} />}
    </>
  );
}
