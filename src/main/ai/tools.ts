import { tool } from "@langchain/core/tools";
import { z } from "zod";

const SAY_HELLO_URL = "http://127.0.0.1:18765/api/say-hello";

/**
 * The one and only tool the agent may call. It performs a real HTTP POST to
 * the Express server started in server.ts — the model never talks to the
 * network directly, and the app never talks to any other host or port.
 */
export const sayHelloTool = tool(
  async ({ message }: { message: string }) => {
    const response = await fetch(SAY_HELLO_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ message })
    });

    return await response.json();
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
 * node-llama-cpp's own function-calling mechanism (grammar-constrained, so
 * it works reliably even with a small 1B model) needs a JSON-schema-shaped
 * function definition rather than a Zod schema. It is kept in sync with
 * sayHelloTool.schema above by hand, since this project intentionally has
 * exactly one tool. The handler below does not duplicate any logic — it
 * just calls the same LangChain tool, so sayHelloTool.invoke() remains the
 * single place that actually performs the HTTP request.
 */
export const sayHelloFunction = {
  description: sayHelloTool.description,
  params: {
    type: "object",
    properties: {
      message: {
        type: "string",
        description: 'The greeting to send, e.g. "Hello Jack"'
      }
    },
    required: ["message"]
  },
  handler: async (params: { message: string }) => sayHelloTool.invoke(params)
} as const;
