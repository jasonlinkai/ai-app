import {
  StateGraph,
  MessagesAnnotation,
  START,
  END,
  MemorySaver
} from "@langchain/langgraph";
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import { getChatSession } from "./model";
import { sayHelloFunction } from "./tools";

/** A single fixed thread id — this demo only needs one conversation per app session. */
const SESSION_THREAD_ID = "local-chat-session";

/**
 * The single LangGraph node for this demo. It:
 *   1. Sends the newest user message to the local model.
 *   2. Lets node-llama-cpp's grammar-constrained function calling decide
 *      whether say_hello should run, and if so, runs it (via the LangChain
 *      tool defined in tools.ts) and feeds the result back to the model.
 *   3. Returns the resulting messages (tool call + tool result + final
 *      assistant reply) to be appended to the graph's message-history state.
 */
async function agentNode(
  state: typeof MessagesAnnotation.State
): Promise<Partial<typeof MessagesAnnotation.State>> {
  const lastMessage = state.messages[state.messages.length - 1];
  const userText =
    typeof lastMessage.content === "string"
      ? lastMessage.content
      : JSON.stringify(lastMessage.content);

  const session = await getChatSession();

  const result = await session.promptWithMeta(userText, {
    functions: { say_hello: sayHelloFunction },
    maxTokens: 512
  });

  const newMessages: BaseMessage[] = [];
  let callIndex = 0;

  for (const item of result.response) {
    if (typeof item === "string" || item.type !== "functionCall") continue;

    const toolCallId = `${item.name}-${callIndex++}`;

    newMessages.push(
      new AIMessage({
        content: "",
        tool_calls: [
          { name: item.name, args: item.params as Record<string, unknown>, id: toolCallId }
        ]
      })
    );
    newMessages.push(
      new ToolMessage({
        content: JSON.stringify(item.result),
        tool_call_id: toolCallId,
        name: item.name
      })
    );
  }

  newMessages.push(new AIMessage(result.responseText));

  return { messages: newMessages };
}

const checkpointer = new MemorySaver();

const compiledGraph = new StateGraph(MessagesAnnotation)
  .addNode("agent", agentNode)
  .addEdge(START, "agent")
  .addEdge("agent", END)
  .compile({ checkpointer });

/**
 * Entry point used by the IPC handler in main.ts. Conversation history is
 * kept by LangGraph's checkpointer (keyed by SESSION_THREAD_ID) across
 * calls, so each new user message is processed with the full prior
 * conversation already loaded into state — a brand new agent/graph is not
 * created per message.
 */
export async function sendMessage(userText: string): Promise<string> {
  const output = await compiledGraph.invoke(
    { messages: [new HumanMessage(userText)] },
    { configurable: { thread_id: SESSION_THREAD_ID } }
  );

  const last = output.messages[output.messages.length - 1];
  return typeof last.content === "string" ? last.content : JSON.stringify(last.content);
}
