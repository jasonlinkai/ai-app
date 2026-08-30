import type { z } from "zod";

/**
 * A tool an adapter may offer to the model. `schema` is a plain Zod
 * schema — framework-agnostic on purpose, so it doesn't leak any one
 * runtime's grammar/function-calling format into this contract. Each
 * adapter implementation converts it into whatever shape its own runtime
 * needs (see zodToGbnf.ts for node-llama-cpp's).
 */
/** Defaults to `any`, not `unknown`, so a heterogeneous ToolDefinition[]
 * (each entry with its own concrete Args/Result) stays assignable to
 * ToolDefinition[] — `unknown` would make handler's parameter type
 * incompatible in the contravariant position and break that assignment. */
export type ToolDefinition<Args = any, Result = any> = {
  name: string;
  description: string;
  schema: z.ZodType<Args>;
  handler: (args: Args) => Promise<Result>;
};

export type ToolCallResult = {
  name: string;
  args: unknown;
  result: unknown;
};

export type LlmTurnResult = {
  toolCalls: ToolCallResult[];
  responseText: string;
};

/**
 * What agent.ts needs from a local LLM runtime: send one user turn, get
 * back whatever tool calls happened (already executed) plus the model's
 * final text. Swapping the runtime behind this (a different local engine,
 * a different tool-calling mechanism) means writing a new implementation
 * of this interface — agent.ts does not change.
 */
export interface LocalLlmAdapter {
  chat(userText: string, tools: ToolDefinition[]): Promise<LlmTurnResult>;
}
