import type { ChatTransport, UIMessage, UIMessageChunk } from "ai";

/**
 * @ai-sdk/react's useChat() expects a ChatTransport that sends the message
 * history to some backend and gets back a ReadableStream<UIMessageChunk> —
 * normally an HTTP fetch to a streaming API route. This app has no HTTP API
 * for chat (window.ai.chat() is a single Electron IPC round trip that
 * resolves once the whole turn — including any tool call — is done), so
 * this transport adapts one to the other.
 *
 * It calls window.ai.chat() with the latest user message, and while that
 * call is in flight it also listens for live tool-call events pushed from
 * the main process (window.ai.onToolEvent — see toolEvents.ts / main.ts).
 * Those events are turned into real tool-call UIMessageChunks as they
 * happen, so the UI shows "say_hello is running" the moment the main
 * process actually starts the HTTP request, not only after the whole reply
 * comes back. Once window.ai.chat() resolves, the final text is appended
 * and the stream closes — a normal completed turn, just assembled from a
 * live event plus one blocking call instead of true token streaming.
 *
 * Conversation history itself is not sent — the main process already keeps
 * it (see agent.ts's LangGraph checkpointer), so only the newest user
 * message's text is forwarded over IPC.
 */
export class ElectronIpcChatTransport implements ChatTransport<UIMessage> {
  async sendMessages({
    messages
  }: Parameters<ChatTransport<UIMessage>["sendMessages"]>[0]): Promise<ReadableStream<UIMessageChunk>> {
    const lastMessage = messages[messages.length - 1];
    const userText = lastMessage.parts
      .filter((part): part is Extract<typeof part, { type: "text" }> => part.type === "text")
      .map((part) => part.text)
      .join("");

    return new ReadableStream<UIMessageChunk>({
      async start(controller) {
        controller.enqueue({ type: "start" });
        controller.enqueue({ type: "start-step" });

        const unsubscribe = window.ai.onToolEvent((event) => {
          if (event.type === "tool-call-start") {
            controller.enqueue({
              type: "tool-input-available",
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              input: event.args
            });
          } else if (event.type === "tool-call-end") {
            controller.enqueue({
              type: "tool-output-available",
              toolCallId: event.toolCallId,
              output: event.result
            });
          }
        });

        try {
          const replyText = await window.ai.chat(userText);

          const partId = crypto.randomUUID();
          controller.enqueue({ type: "text-start", id: partId });
          controller.enqueue({ type: "text-delta", id: partId, delta: replyText });
          controller.enqueue({ type: "text-end", id: partId });
          controller.enqueue({ type: "finish-step" });
          controller.enqueue({ type: "finish" });
          controller.close();
        } catch (err) {
          controller.error(err);
        } finally {
          unsubscribe();
        }
      }
    });
  }

  async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    // Nothing to resume — each turn is one IPC round trip, not a
    // long-lived stream that could be interrupted and reconnected to.
    return null;
  }
}

export const electronIpcChatTransport = new ElectronIpcChatTransport();
