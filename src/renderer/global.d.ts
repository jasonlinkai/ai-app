export {};

type ToolEvent =
  | { type: "tool-call-start"; toolCallId: string; toolName: string; args: unknown }
  | { type: "tool-call-end"; toolCallId: string; result: unknown };

declare global {
  interface Window {
    ai: {
      chat: (message: string) => Promise<string>;
      onToolEvent: (callback: (event: ToolEvent) => void) => () => void;
    };
  }
}
