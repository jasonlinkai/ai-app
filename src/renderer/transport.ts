import type { ChatTransport, UIMessage, UIMessageChunk } from "ai";

/**
 * @ai-sdk/react's useChat() expects a ChatTransport that sends the message
 * history to some backend and gets back a ReadableStream<UIMessageChunk> —
 * normally an HTTP fetch to a streaming API route. This app has no HTTP API
 * for chat (window.ai.chat() is a single Electron IPC round trip that
 * resolves with the whole reply at once), so this transport adapts one to
 * the other: it calls window.ai.chat() with the latest user message, then
 * wraps the single resulting string in a minimal valid UIMessageChunk
 * stream (start → text → finish) so useChat sees it as a completed,
 * non-streaming turn.
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

    const replyText = await window.ai.chat(userText);

    return new ReadableStream<UIMessageChunk>({
      start(controller) {
        const partId = crypto.randomUUID();
        controller.enqueue({ type: "start" });
        controller.enqueue({ type: "start-step" });
        controller.enqueue({ type: "text-start", id: partId });
        controller.enqueue({ type: "text-delta", id: partId, delta: replyText });
        controller.enqueue({ type: "text-end", id: partId });
        controller.enqueue({ type: "finish-step" });
        controller.enqueue({ type: "finish" });
        controller.close();
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
