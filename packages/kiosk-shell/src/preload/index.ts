import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { InvokeChannel, KioskApi, KioskView, PushChannel } from "../common/api";

// Exposes exactly the KioskApi as window.kiosk. Only "electron" may be required here.

const invoke = (channel: InvokeChannel, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args);
const UPDATE: PushChannel = "kiosk:update";

const api: KioskApi = {
  getView: () => invoke("kiosk:view"),
  onView: (listener) => {
    const wrapped = (_event: IpcRendererEvent, view: KioskView) => listener(view);
    ipcRenderer.on(UPDATE, wrapped);
    return () => ipcRenderer.removeListener(UPDATE, wrapped);
  },
  launchApp: (id) => invoke("kiosk:launch", id),
  openSite: (id) => invoke("kiosk:open", id),
  appIcon: (id) => invoke("kiosk:icon", id),
  restore: (password) => invoke("kiosk:restore", password),
};

contextBridge.exposeInMainWorld("kiosk", api);
