import { useState } from "react";
import { MAX_UNLOCK_SEC, MIN_UNLOCK_SEC, type MachineId } from "@asd/shared";
import type { MachineCommand, MachineView, Snapshot } from "../../common/api";
import { api, formatDuration, formatTime, useNow } from "../api";
import { t } from "../strings";

type Props = { readonly snapshot: Snapshot };

export function MachinesPage({ snapshot }: Props) {
  const [selected, setSelected] = useState<ReadonlySet<MachineId>>(new Set());
  const [message, setMessage] = useState<string | null>(null);
  const now = useNow();
  const elapsedSec = Math.max(0, Math.floor((now - snapshot.takenAt) / 1000));
  const ids = [...selected].filter((id) => snapshot.machines.some((m) => m.id === id));

  const toggle = (id: MachineId) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allSelected = snapshot.machines.length > 0 && ids.length === snapshot.machines.length;

  const send = async (command: MachineCommand) => {
    const result = await api.sendCommand(ids, command);
    if (!result.ok) return setMessage(t.errorPrefix + result.error);
    const missed = result.value.filter((outcome) => !outcome.delivered).length;
    setMessage(missed > 0 ? t.machines.notDelivered(missed) : null);
  };
  const askMinutes = (): number | null => {
    const answer = window.prompt(t.machines.minutesPrompt, "60");
    const minutes = Number(answer);
    const sec = Math.round(minutes * 60);
    return Number.isFinite(sec) && sec >= MIN_UNLOCK_SEC && sec <= MAX_UNLOCK_SEC ? sec : null;
  };
  const confirmPower = (label: string, action: "restart" | "shutdown") => {
    if (window.confirm(t.machines.confirmPower(label, ids.length))) void send({ type: "power", action });
  };

  if (snapshot.machines.length === 0) return <p className="empty">{t.machines.empty}</p>;

  return (
    <section>
      <div className="toolbar">
        <span className="muted">{t.machines.selected(ids.length)}</span>
        <button disabled={ids.length === 0} onClick={() => void send({ type: "unlock", durationSec: 3600 })}>{t.machines.unlock1h}</button>
        <button disabled={ids.length === 0} onClick={() => void send({ type: "unlock", durationSec: 7200 })}>{t.machines.unlock2h}</button>
        <button disabled={ids.length === 0} onClick={() => { const sec = askMinutes(); if (sec !== null) void send({ type: "unlock", durationSec: sec }); }}>{t.machines.unlockCustom}</button>
        <button disabled={ids.length === 0} onClick={() => { const sec = askMinutes(); if (sec !== null) void send({ type: "extend", durationSec: sec }); }}>{t.machines.extend}</button>
        <button disabled={ids.length === 0} className="warn" onClick={() => void send({ type: "lock" })}>{t.machines.lock}</button>
        <button disabled={ids.length === 0} onClick={() => void send({ type: "rearm" })}>{t.machines.rearm}</button>
        <button disabled={ids.length === 0} onClick={() => confirmPower(t.machines.restart, "restart")}>{t.machines.restart}</button>
        <button disabled={ids.length === 0} className="danger" onClick={() => confirmPower(t.machines.shutdown, "shutdown")}>{t.machines.shutdown}</button>
      </div>
      {message !== null && <p className="notice">{message}</p>}
      <table>
        <thead>
          <tr>
            <th>
              <input type="checkbox" aria-label={t.machines.selectAll} checked={allSelected}
                onChange={() => setSelected(allSelected ? new Set() : new Set(snapshot.machines.map((m) => m.id)))} />
            </th>
            <th>{t.machines.name}</th>
            <th>{t.machines.status}</th>
            <th>{t.machines.remaining}</th>
            <th>{t.machines.lastSeen}</th>
            <th>{t.machines.sync}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {snapshot.machines.map((machine) => (
            <MachineRow key={machine.id} machine={machine} elapsedSec={elapsedSec}
              checked={selected.has(machine.id)} onToggle={() => toggle(machine.id)} onMessage={setMessage} />
          ))}
        </tbody>
      </table>
    </section>
  );
}

type RowProps = {
  readonly machine: MachineView;
  readonly elapsedSec: number;
  readonly checked: boolean;
  readonly onToggle: () => void;
  readonly onMessage: (message: string | null) => void;
};

function MachineRow({ machine, elapsedSec, checked, onToggle, onMessage }: RowProps) {
  const remaining = machine.remainingSec === null ? null : Math.max(0, machine.remainingSec - elapsedSec);
  const stateLabel = machine.state === null ? t.states.unknown : t.states[machine.state];
  const synced = machine.passwordSynced && machine.policySynced;

  const rename = async () => {
    const name = window.prompt(t.machines.renamePrompt, machine.name);
    if (name === null) return;
    const result = await api.renameMachine(machine.id, name);
    onMessage(result.ok ? null : t.errorPrefix + result.error);
  };
  const remove = async () => {
    if (!window.confirm(t.machines.confirmRemove(machine.name))) return;
    const result = await api.revokeMachine(machine.id);
    onMessage(result.ok ? null : t.errorPrefix + result.error);
  };

  return (
    <tr className={checked ? "selected" : ""}>
      <td><input type="checkbox" checked={checked} onChange={onToggle} aria-label={machine.name} /></td>
      <td>
        <strong>{machine.name}</strong>
        <div className="muted small">{machine.hostname} · {machine.id.slice(0, 8)}</div>
      </td>
      <td>
        <span className={`dot ${machine.online ? "on" : "off"}`} title={machine.online ? t.machines.online : t.machines.offline} />
        <span className={`badge ${machine.state ?? "unknown"}`}>{stateLabel}</span>
        {machine.dryRun === true && <span className="tag">{t.machines.dryRun}</span>}
        {machine.enforcement === "audit" && <span className="tag">{t.machines.audit}</span>}
      </td>
      <td>{remaining === null ? "—" : formatDuration(remaining)}</td>
      <td>{machine.online ? t.machines.online : formatTime(machine.lastSeen, t.machines.never)}</td>
      <td className={synced ? "ok" : "pending"}>{synced ? t.machines.synced : t.machines.pending}</td>
      <td className="actions">
        <button className="link" onClick={() => void rename()}>{t.machines.rename}</button>
        <button className="link danger" onClick={() => void remove()}>{t.machines.remove}</button>
      </td>
    </tr>
  );
}
