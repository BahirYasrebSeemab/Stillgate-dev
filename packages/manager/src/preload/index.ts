import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { InvokeChannel, ManagerApi, PushChannel, Snapshot } from "../common/api";

// The bridge between the sandboxed UI and the main process.
// Exposes exactly the ManagerApi functions as window.asd, nothing else
// (the page never gets ipcRenderer itself). Only "electron" may be required here.

const invoke = (channel: InvokeChannel, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args);
const UPDATE: PushChannel = "asd:update";

const api: ManagerApi = {
  getSnapshot: () => invoke("asd:snapshot"),
  onUpdate: (listener) => {
    const wrapped = (_event: IpcRendererEvent, snapshot: Snapshot) => listener(snapshot);
    ipcRenderer.on(UPDATE, wrapped);
    return () => ipcRenderer.removeListener(UPDATE, wrapped);
  },
  sendCommand: (ids, command) => invoke("asd:command", ids, command),
  renameMachine: (id, name) => invoke("asd:rename", id, name),
  revokeMachine: (id) => invoke("asd:revoke", id),
  savePolicy: (policy) => invoke("asd:savePolicy", policy),
  setPassword: (password, confirmation) => invoke("asd:setPassword", password, confirmation),
  createPairing: (address) => invoke("asd:createPairing", address),
  copyText: (text) => invoke("asd:copy", text),
};

contextBridge.exposeInMainWorld("asd", api);
