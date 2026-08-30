import { EventEmitter } from "node:events";

export type ToolEvent =
  | { type: "tool-call-start"; toolCallId: string; toolName: string; args: unknown }
  | { type: "tool-call-end"; toolCallId: string; result: unknown };

const emitter = new EventEmitter();
const CHANNEL = "event";

export function emitToolEvent(event: ToolEvent): void {
  emitter.emit(CHANNEL, event);
}

/** Returns an unsubscribe function. */
export function onToolEvent(listener: (event: ToolEvent) => void): () => void {
  emitter.on(CHANNEL, listener);
  return () => emitter.off(CHANNEL, listener);
}
