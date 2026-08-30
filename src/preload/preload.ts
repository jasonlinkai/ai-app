import { contextBridge, ipcRenderer } from "electron";

/**
 * The only thing exposed to the renderer: window.ai.chat(message).
 * contextIsolation is on and nodeIntegration is off (see main.ts), so this
 * is the entire surface React has access to — no Node.js APIs leak through.
 */
const api = {
  chat: (message: string): Promise<string> => ipcRenderer.invoke("ai:chat", message)
};

contextBridge.exposeInMainWorld("ai", api);

export type AiApi = typeof api;
