import path from "node:path";
import { app, BrowserWindow, ipcMain } from "electron";
import { startServer, stopServer } from "./server";
import { sendMessage } from "./ai/agent";
import { getModelPath } from "./ai/model";
import { onToolEvent } from "./ai/toolEvents";

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 720,
    title: "Local AI Assistant",
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  // electron-vite sets ELECTRON_RENDERER_URL when running "electron-vite dev".
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(() => {
  console.log("Local GGUF model path:", getModelPath());
  startServer();

  ipcMain.handle("ai:chat", async (_event, userText: unknown) => {
    if (typeof userText !== "string" || !userText.trim()) {
      throw new Error("Message must be a non-empty string.");
    }
    return sendMessage(userText);
  });

  onToolEvent((event) => {
    mainWindow?.webContents.send("ai:tool-event", event);
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => {
  stopServer();
});
