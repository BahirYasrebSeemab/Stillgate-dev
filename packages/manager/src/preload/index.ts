import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { InvokeChannel, ManagerApi, PushChannel, Snapshot } from "../common/api";

// The bridge between the sandboxed UI and the main process.
// Exposes exactly the ManagerApi functions as window.stillgate, nothing else
// (the page never gets ipcRenderer itself). Only "electron" may be required here.

const invoke = (channel: InvokeChannel, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args);
const UPDATE: PushChannel = "stillgate:update";

const api: ManagerApi = {
  getSnapshot: () => invoke("stillgate:snapshot"),
  onUpdate: (listener) => {
    const wrapped = (_event: IpcRendererEvent, snapshot: Snapshot) => listener(snapshot);
    ipcRenderer.on(UPDATE, wrapped);
    return () => ipcRenderer.removeListener(UPDATE, wrapped);
  },
  sendCommand: (ids, command) => invoke("stillgate:command", ids, command),
  renameMachine: (id, name) => invoke("stillgate:rename", id, name),
  revokeMachine: (id) => invoke("stillgate:revoke", id),
  savePolicy: (policy) => invoke("stillgate:savePolicy", policy),
  setPassword: (password, confirmation) => invoke("stillgate:setPassword", password, confirmation),
  createPairing: (address) => invoke("stillgate:createPairing", address),
  copyText: (text) => invoke("stillgate:copy", text),
};

contextBridge.exposeInMainWorld("stillgate", api);
