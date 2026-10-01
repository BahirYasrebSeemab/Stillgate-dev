import { PersistedState, type LockState } from "@asd/shared";
import { readJson, writeJsonAtomic, type Logger } from "@asd/shared/node";
import type { Clock } from "../deps";

export async function loadState(file: string, log: Logger): Promise<PersistedState | null> {
  const result = await readJson(file, PersistedState);
  if (result.ok) return result.value;
  if (result.error.kind === "corrupt") log.error("state_file_corrupt", { detail: result.error.detail });
  return null; // missing or corrupt -> bootRule starts LOCKED
}

export async function saveState(file: string, state: LockState, clock: Clock): Promise<void> {
  const data: PersistedState = {
    schemaVersion: 1,
    state,
    bootWallMs: clock.bootWallMs(),
    savedAtWall: clock.wallMs(),
  };
  await writeJsonAtomic(file, data);
}
