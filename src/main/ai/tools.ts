import { randomUUID } from "node:crypto";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { emitToolEvent } from "./toolEvents";
import type { ToolDefinition } from "./llmAdapter";

const SAY_HELLO_URL = "http://127.0.0.1:18765/api/say-hello";

/**
 * The one and only tool the agent may call. It performs a real HTTP POST to
 * the Express server started in server.ts — the model never talks to the
 * network directly, and the app never talks to any other host or port.
 *
 * It also emits start/end events (toolEvents.ts) around the request so the
 * renderer can show live "calling say_hello…" / "done" status — see
 * transport.ts, which turns these into UIMessageChunk tool-call parts.
 */
export const sayHelloTool = tool(
  async ({ message }: { message: string }) => {
    const toolCallId = randomUUID();
    emitToolEvent({ type: "tool-call-start", toolCallId, toolName: "say_hello", args: { message } });

    const response = await fetch(SAY_HELLO_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ message })
    });

    const result = await response.json();
    emitToolEvent({ type: "tool-call-end", toolCallId, result });
    return result;
  },
  {
    name: "say_hello",
    description:
      "Send a hello message to the Electron application's local HTTP server.",
    schema: z.object({
      message: z.string().describe('The greeting to send, e.g. "Hello Jack"')
    })
  }
);

/**
 * The runtime-agnostic view of the same tool (see llmAdapter.ts): reuses
 * sayHelloTool's Zod schema directly rather than a hand-duplicated copy,
 * and its handler just calls sayHelloTool.invoke() — sayHelloTool remains
 * the single place that actually performs the HTTP request. Each
 * LocalLlmAdapter implementation (model.ts's, or any future one) converts
 * `schema` into whatever shape its own runtime needs.
 */
export const sayHelloToolDefinition: ToolDefinition<{ message: string }> = {
  name: sayHelloTool.name,
  description: sayHelloTool.description,
  schema: sayHelloTool.schema,
  handler: async (params) => sayHelloTool.invoke(params)
};

/** Every tool the agent may use. Add new tools here — agent.ts and each
 * LocalLlmAdapter implementation pick them up without further changes. */
export const allTools: ToolDefinition[] = [sayHelloToolDefinition];
