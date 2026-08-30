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
  if (role === "user") {
    return (
      <MessagePrimitive.Root className="flex max-w-[70%] flex-col items-end gap-1 self-end">
        <div className="text-[11px] uppercase tracking-wide text-neutral-400">You</div>
        <div className="whitespace-pre-wrap break-words rounded-2xl bg-blue-600 px-3.5 py-2.5 text-sm leading-relaxed text-white">
          <MessagePrimitive.Content />
        </div>
      </MessagePrimitive.Root>
    );
  }

  return (
    <MessagePrimitive.Root className="flex max-w-[70%] flex-col items-start gap-1 self-start">
      <div className="text-[11px] uppercase tracking-wide text-neutral-400">AI</div>

      <MessagePrimitive.Content>
        {({ part }) => {
          if (part.type === "tool-call") return <ToolCallStatus part={part} />;

          if (part.type === "text") {
            if (part.text === "" && part.status?.type === "running") {
              return <ThinkingBubble />;
            }
            return (
              <div className="whitespace-pre-wrap break-words rounded-2xl border border-neutral-200 bg-white px-3.5 py-2.5 text-sm leading-relaxed text-neutral-900">
                {part.text}
              </div>
            );
          }

          return null;
        }}
      </MessagePrimitive.Content>

      <MessagePrimitive.Error>
        <ErrorPrimitive.Root className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          <ErrorPrimitive.Message />
        </ErrorPrimitive.Root>
      </MessagePrimitive.Error>
    </MessagePrimitive.Root>
  );
}

type ToolCallPart = {
  type: "tool-call";
  toolName: string;
  args: unknown;
  result?: unknown;
  status: { type: string };
};

/** Live "say_hello is running / done" status card — this is what makes the
 * tool call visible to the user as it happens, not just the final reply. */
function ToolCallStatus({ part }: { part: ToolCallPart }) {
  const isRunning = part.status.type === "running";
  const message = (part.args as { message?: string } | undefined)?.message ?? "";

  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-neutral-100 px-2.5 py-1.5 text-xs text-neutral-600">
      <span>{isRunning ? "🔧" : "✅"}</span>
      <span>
        {part.toolName}
        {message ? `("${message}")` : ""} {isRunning ? "— running…" : "— done"}
      </span>
    </div>
  );
}

function ThinkingBubble() {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white px-3.5 py-2.5 text-sm italic text-neutral-400">
      Thinking…
    </div>
  );
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
