import path from "node:path";
import { app, BrowserWindow, ipcMain } from "electron";
import { startServer, stopServer } from "./server";
import { sendMessage } from "./ai/agent";
import { getModelPath } from "./ai/model";

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

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // TEMPORARY renderer UI self-test, not part of the app.
  if (process.env.RENDERER_SELF_TEST === "1" && mainWindow) {
    mainWindow.webContents.once("did-finish-load", () => {
      setTimeout(() => {
        void (async () => {
          try {
            await mainWindow!.webContents.executeJavaScript(`
              (function () {
                const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
                const textarea = document.querySelector("textarea");
                const button = document.querySelector("form button");
                setter.call(textarea, "Say hello to Jack");
                textarea.dispatchEvent(new Event("input", { bubbles: true }));
                button.click();
              })()
            `);
            const midStart = Date.now();
            while (Date.now() - midStart < 20000) {
              const state = await mainWindow!.webContents.executeJavaScript(`
                (function () {
                  const text = document.body.innerText;
                  return { hasUser: text.includes("Say hello to Jack"), hasFinal: text.includes("Sent a greeting") };
                })()
              `);
              if (state.hasUser && !state.hasFinal) break;
              await new Promise((r) => setTimeout(r, 100));
            }
            const midImage = await mainWindow!.webContents.capturePage();
            require("node:fs").writeFileSync("/tmp/ui-screenshot-thinking.png", midImage.toPNG());
            console.log("MID SCREENSHOT SAVED");

            const start = Date.now();
            while (Date.now() - start < 90000) {
              const done = await mainWindow!.webContents.executeJavaScript(
                `document.body.innerText.includes("Sent a greeting")`
              );
              if (done) break;
              await new Promise((r) => setTimeout(r, 500));
            }
            const finalImage = await mainWindow!.webContents.capturePage();
            require("node:fs").writeFileSync("/tmp/ui-screenshot-final.png", finalImage.toPNG());
            console.log("FINAL SCREENSHOT SAVED");
          } catch (err) {
            console.error("RENDERER SELF TEST ERROR:", err);
          }
          app.quit();
        })();
      }, 500);
    });
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => {
  stopServer();
});
