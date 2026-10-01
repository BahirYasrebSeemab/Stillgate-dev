import { useEffect, useRef, useState } from "react";
import type { KioskApi, KioskView } from "../common/api";
import { HotkeyDetector, type HotkeyMode } from "./hotkey";

declare global {
  interface Window {
    readonly kiosk: KioskApi;
  }
}

export const api: KioskApi = window.kiosk;

export function useKioskView(): KioskView {
  const [view, setView] = useState<KioskView>({ state: null, receivedAt: Date.now() });
  useEffect(() => {
    let active = true;
    void api.getView().then((first) => active && setView(first));
    const unsubscribe = api.onView(setView);
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  return view;
}

export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

// Listens to the whole window for the maintenance hotkey
export function useHotkey(onTrigger: () => void, mode: HotkeyMode = "either"): void {
  const callback = useRef(onTrigger);
  callback.current = onTrigger;
  useEffect(() => {
    const detector = new HotkeyDetector(mode);
    const down = (event: KeyboardEvent) => {
      // Space would also "click" the focused tile; block that (but still allow typing a space)
      if (event.code === "Space" && !(event.target instanceof HTMLInputElement)) event.preventDefault();
      if (detector.keyDown(event.code, Date.now(), event.repeat)) callback.current();
    };
    const up = (event: KeyboardEvent) => detector.keyUp(event.code);
    const blur = () => detector.clear();
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up, true);
      window.removeEventListener("blur", blur);
    };
  }, [mode]);
}

export function formatClock(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
