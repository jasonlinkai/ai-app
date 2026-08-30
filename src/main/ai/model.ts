import path from "node:path";
import fs from "node:fs";
import { app } from "electron";
import type { LlamaChatSession as LlamaChatSessionType, ChatSessionModelFunctions } from "node-llama-cpp";
import type { LocalLlmAdapter, LlmTurnResult, ToolDefinition } from "./llmAdapter";
import { zodToGbnfSchema } from "./zodToGbnf";

const MODEL_FILENAME = "model.gguf";
const LORA_FILENAME = "adapter.gguf";

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

/**
 * A GGUF LoRA adapter (see finetune/ for how to produce one) is entirely
 * optional and applied at runtime, on top of the unmodified base model —
 * it is never merged into resources/models/model.gguf. Same resolution
 * pattern as the base model, but resolves to `undefined` if no adapter
 * file exists at the resolved location, since this app runs perfectly
 * fine without one.
 */
function resolveLoraPath(): string | undefined {
  const loraPath =
    process.env.LOCAL_LORA_PATH ??
    (app.isPackaged
      ? path.join(process.resourcesPath, "models", LORA_FILENAME)
      : path.join(process.cwd(), "resources", "models", LORA_FILENAME));

  return fs.existsSync(loraPath) ? loraPath : undefined;
}

/**
 * node-llama-cpp's LocalLlmAdapter implementation. Every node-llama-cpp
 * type/call (LlamaChatSession, promptWithMeta, its GBNF function-calling
 * format) is contained in this class — agent.ts only ever sees the
 * LocalLlmAdapter interface, so swapping in a different local runtime
 * later means writing a new class here, not touching agent.ts.
 */
class NodeLlamaCppAdapter implements LocalLlmAdapter {
  readonly #session: LlamaChatSessionType;

  constructor(session: LlamaChatSessionType) {
    this.#session = session;
  }

  async chat(userText: string, tools: ToolDefinition[]): Promise<LlmTurnResult> {
    const functions: Record<string, ChatSessionModelFunctions[string]> = {};
    for (const t of tools) {
      functions[t.name] = {
        description: t.description,
        params: zodToGbnfSchema(t.schema),
        handler: t.handler
      };
    }

    const result = await this.#session.promptWithMeta(userText, { functions, maxTokens: 512 });

    const toolCalls: LlmTurnResult["toolCalls"] = [];
    for (const item of result.response) {
      if (typeof item === "string" || item.type !== "functionCall") continue;
      toolCalls.push({ name: item.name, args: item.params, result: item.result });
    }

    return { toolCalls, responseText: result.responseText };
  }
}

let adapterPromise: Promise<LocalLlmAdapter> | null = null;

async function createAdapter(): Promise<LocalLlmAdapter> {
  // node-llama-cpp is ESM-only. main/preload are built as CommonJS by
  // electron-vite, so it is loaded with a dynamic import() rather than a
  // static "import" — this is node-llama-cpp's documented way of being
  // used from a CommonJS entry point.
  const { getLlama, LlamaChatSession } = await import("node-llama-cpp");

  const modelPath = resolveModelPath();
  const loraPath = resolveLoraPath();
  if (loraPath) console.log("Loaded LoRA adapter:", loraPath);

  const llama = await getLlama();
  const model = await llama.loadModel({ modelPath });
  const context = await model.createContext(loraPath ? { lora: { adapters: [{ filePath: loraPath }] } } : {});

  const session = new LlamaChatSession({
    contextSequence: context.getSequence(),
    systemPrompt:
      "You are a minimal local assistant running fully on-device, with no " +
      "internet access. Whenever the user asks you to greet, say hello, " +
      "say hi, or send a message to someone, call the say_hello function " +
      "with a short friendly greeting as its message argument, every time " +
      "such a request appears, then briefly confirm the message was sent. " +
      "For anything else, reply directly in plain text, concisely."
  });

  return new NodeLlamaCppAdapter(session);
}

/**
 * The same adapter (and underlying LlamaChatSession) is reused for the
 * entire app session, so the model keeps the running conversation in its
 * own context window across turns (see agent.ts for how this ties into
 * LangGraph's state).
 */
export function getLlmAdapter(): Promise<LocalLlmAdapter> {
  if (!adapterPromise) {
    adapterPromise = createAdapter();
  }
  return adapterPromise;
}

export function getModelPath(): string {
  return resolveModelPath();
}
