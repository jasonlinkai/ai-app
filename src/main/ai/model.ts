import path from "node:path";
import { app } from "electron";
import type { LlamaChatSession as LlamaChatSessionType } from "node-llama-cpp";

const MODEL_FILENAME = "model.gguf";

/**
 * Development: resources/models/model.gguf next to the project root
 * (or LOCAL_MODEL_PATH, for pointing at a model stored elsewhere while developing).
 *
 * Production: the model is copied outside the asar archive by electron-builder
 * (see electron-builder.yml "extraResources"), so it must be resolved via
 * process.resourcesPath rather than any path that only exists during development.
 */
function resolveModelPath(): string {
  if (process.env.LOCAL_MODEL_PATH) {
    return process.env.LOCAL_MODEL_PATH;
  }

  if (app.isPackaged) {
    return path.join(process.resourcesPath, "models", MODEL_FILENAME);
  }

  return path.join(process.cwd(), "resources", "models", MODEL_FILENAME);
}

let sessionPromise: Promise<LlamaChatSessionType> | null = null;

async function createSession(): Promise<LlamaChatSessionType> {
  // node-llama-cpp is ESM-only. main/preload are built as CommonJS by
  // electron-vite, so it is loaded with a dynamic import() rather than a
  // static "import" — this is node-llama-cpp's documented way of being
  // used from a CommonJS entry point.
  const { getLlama, LlamaChatSession } = await import("node-llama-cpp");

  const modelPath = resolveModelPath();

  const llama = await getLlama();
  const model = await llama.loadModel({ modelPath });
  const context = await model.createContext();

  return new LlamaChatSession({
    contextSequence: context.getSequence(),
    systemPrompt:
      "You are a minimal local assistant running fully on-device, with no " +
      "internet access. Whenever the user asks you to greet, say hello, " +
      "say hi, or send a message to someone, call the say_hello function " +
      "with a short friendly greeting as its message argument, every time " +
      "such a request appears, then briefly confirm the message was sent. " +
      "For anything else, reply directly in plain text, concisely."
  });
}

/**
 * The same LlamaChatSession instance is reused for the entire app session,
 * so the model keeps the running conversation in its own context window
 * across turns (see agent.ts for how this ties into LangGraph's state).
 */
export function getChatSession(): Promise<LlamaChatSessionType> {
  if (!sessionPromise) {
    sessionPromise = createSession();
  }
  return sessionPromise;
}

export function getModelPath(): string {
  return resolveModelPath();
}
