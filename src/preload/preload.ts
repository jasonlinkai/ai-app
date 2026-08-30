import { contextBridge, ipcRenderer } from "electron";
import type { ToolEvent } from "../main/ai/toolEvents";

/**
 * The only things exposed to the renderer: window.ai.chat(message) and
 * window.ai.onToolEvent(callback). contextIsolation is on and
 * nodeIntegration is off (see main.ts), so this is the entire surface React
 * has access to — no Node.js APIs leak through.
 */
const api = {
  chat: (message: string): Promise<string> => ipcRenderer.invoke("ai:chat", message),
  onToolEvent: (callback: (event: ToolEvent) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: ToolEvent): void => callback(payload);
    ipcRenderer.on("ai:tool-event", listener);
    return () => ipcRenderer.removeListener("ai:tool-event", listener);
  }
};

contextBridge.exposeInMainWorld("ai", api);

export type AiApi = typeof api;
