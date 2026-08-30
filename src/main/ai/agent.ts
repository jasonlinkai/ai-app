import {
  StateGraph,
  MessagesAnnotation,
  START,
  END,
  MemorySaver
} from "@langchain/langgraph";
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import { getLlmAdapter } from "./model";
import { allTools } from "./tools";

/** A single fixed thread id — this demo only needs one conversation per app session. */
const SESSION_THREAD_ID = "local-chat-session";

/**
 * The single LangGraph node for this demo. It:
 *   1. Sends the newest user message to the local LLM adapter (model.ts),
 *      offering it every tool in tools.ts's allTools.
 *   2. The adapter decides whether a tool should run and, if so, has
 *      already run it by the time it returns — see llmAdapter.ts.
 *   3. Returns the resulting messages (tool call + tool result + final
 *      assistant reply) to be appended to the graph's message-history state.
 *
 * Nothing here is specific to any one local LLM runtime — that detail
 * lives entirely behind the LocalLlmAdapter interface in model.ts.
 */
async function agentNode(
  state: typeof MessagesAnnotation.State
): Promise<Partial<typeof MessagesAnnotation.State>> {
  const lastMessage = state.messages[state.messages.length - 1];
  const userText =
    typeof lastMessage.content === "string"
      ? lastMessage.content
      : JSON.stringify(lastMessage.content);

  const adapter = await getLlmAdapter();
  const turn = await adapter.chat(userText, allTools);

  const newMessages: BaseMessage[] = [];
  let callIndex = 0;

  for (const call of turn.toolCalls) {
    const toolCallId = `${call.name}-${callIndex++}`;

    newMessages.push(
      new AIMessage({
        content: "",
        tool_calls: [{ name: call.name, args: call.args as Record<string, unknown>, id: toolCallId }]
      })
    );
    newMessages.push(
      new ToolMessage({
        content: JSON.stringify(call.result),
        tool_call_id: toolCallId,
        name: call.name
      })
    );
  }

  newMessages.push(new AIMessage(turn.responseText));

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
