import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  ThreadPrimitive
} from "@assistant-ui/react";
import type { ThreadMessage } from "@assistant-ui/react";
import { useChatRuntime } from "@assistant-ui/ai-sdk";
import { electronIpcChatTransport } from "./transport";

export default function App() {
  const runtime = useChatRuntime({ transport: electronIpcChatTransport });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <Thread />
    </AssistantRuntimeProvider>
  );
}

function Thread() {
  return (
    <ThreadPrimitive.Root className="flex h-screen flex-col bg-neutral-50">
      <header className="border-b border-neutral-200 bg-white px-5 py-3.5 text-[15px] font-semibold">
        Local AI Assistant
      </header>

      <ThreadPrimitive.Viewport className="flex flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
        <ThreadPrimitive.If empty>
          <div className="mt-5 text-sm text-neutral-400">Try: &ldquo;Say hello to Jack&rdquo;</div>
        </ThreadPrimitive.If>

        <ThreadPrimitive.Messages>
          {({ message }: { message: ThreadMessage }) => <Message role={message.role} />}
        </ThreadPrimitive.Messages>
      </ThreadPrimitive.Viewport>

      <Composer />
    </ThreadPrimitive.Root>
  );
}

function Message({ role }: { role: ThreadMessage["role"] }) {
  const isUser = role === "user";
  return (
    <MessagePrimitive.Root
      className={`flex max-w-[70%] flex-col ${isUser ? "self-end items-end" : "self-start items-start"}`}
    >
      <div className="mb-1 text-[11px] uppercase tracking-wide text-neutral-400">
        {isUser ? "You" : "AI"}
      </div>
      <div
        className={`whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
          isUser ? "bg-blue-600 text-white" : "border border-neutral-200 bg-white text-neutral-900"
        }`}
      >
        <MessagePrimitive.Content components={{ Empty: ThinkingIndicator }} />
      </div>
      <MessagePrimitive.Error>
        <ErrorPrimitive.Root className="mt-1 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          <ErrorPrimitive.Message />
        </ErrorPrimitive.Root>
      </MessagePrimitive.Error>
    </MessagePrimitive.Root>
  );
}

function ThinkingIndicator() {
  return <span className="italic text-neutral-400">Thinking…</span>;
}

function Composer() {
  return (
    <ComposerPrimitive.Root className="flex gap-2 border-t border-neutral-200 bg-white px-5 py-3.5">
      <ComposerPrimitive.Input
        placeholder="Type a message..."
        rows={1}
        className="max-h-40 flex-1 resize-none rounded-lg border border-neutral-300 px-3 py-2.5 text-sm outline-none focus:border-blue-600 disabled:bg-neutral-100"
      />
      <ComposerPrimitive.Send className="rounded-lg bg-blue-600 px-4.5 py-2.5 text-sm font-semibold text-white disabled:bg-blue-200">
        Send
      </ComposerPrimitive.Send>
    </ComposerPrimitive.Root>
  );
}
