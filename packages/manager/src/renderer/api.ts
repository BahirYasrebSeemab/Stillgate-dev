import { useEffect, useState } from "react";
import type { ManagerApi, Snapshot } from "../common/api";

// The preload script put the API on window.asd; this tells TypeScript it exists.
declare global {
  interface Window {
    readonly asd: ManagerApi;
  }
}

export const api: ManagerApi = window.asd;

// Live snapshot of the manager state: loaded once, then updated by pushes from the main process
export function useSnapshot(): Snapshot | null {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  useEffect(() => {
    let active = true;
    void api.getSnapshot().then((first) => active && setSnapshot(first));
    const unsubscribe = api.onUpdate(setSnapshot);
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  return snapshot;
}

// Re-renders every second, for live countdowns
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export function formatDuration(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

export function formatTime(ms: number | null, never: string): string {
  return ms === null ? never : new Date(ms).toLocaleString();
}
