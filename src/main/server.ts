import express from "express";
import type { Server } from "node:http";

const HOST = "127.0.0.1";
const PORT = 18765;

let server: Server | null = null;

/**
 * The only API this app exposes. The say_hello LangChain tool calls this
 * over real HTTP — it is never invoked by string-matching the user's text.
 */
export function startServer(): void {
  if (server) return;

  const expressApp = express();
  expressApp.use(express.json());

  expressApp.post("/api/say-hello", (req, res) => {
    const { message } = req.body as { message?: string };
    console.log("AI says:", message);
    res.json({ success: true });
  });

  server = expressApp.listen(PORT, HOST, () => {
    console.log(`Local API server listening on http://${HOST}:${PORT}`);
  });
}

export function stopServer(): void {
  server?.close();
  server = null;
}
