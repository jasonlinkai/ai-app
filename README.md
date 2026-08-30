# Local AI Agent Electron Demo

A minimal, fully working Electron desktop app with an interactive
ChatGPT-style chat UI, backed by a **completely local** AI agent. No Ollama,
no OpenAI/Anthropic/cloud APIs, no Docker, no Python — the LLM runtime
(`node-llama-cpp`, a native Node.js binding for `llama.cpp`) and a small GGUF
model are packaged with the app itself.

## Architecture

```
React Chat UI (assistant-ui primitives, driven by @ai-sdk/react's useChat() under the hood)
 ↓  window.ai.chat(message)   — via a custom ChatTransport, see below
Electron IPC (contextBridge / ipcRenderer.invoke)
 ↓
LangGraph  (StateGraph over MessagesAnnotation, checkpointed per session)
 ↓
node-llama-cpp  (LlamaChatSession, grammar-constrained function calling)
 ↓
GGUF model (1–2B params, runs 100% on-device)
 ↓  (model decides to call it)
say_hello LangChain Tool (Zod-validated)
 ↓
HTTP POST http://127.0.0.1:18765/api/say-hello
 ↓
Express server (bound to 127.0.0.1 only)
 ↓
console.log("AI says: ...")
```

Source layout:

```
src/
  main/
    main.ts        Electron entry point, BrowserWindow, IPC handler
    server.ts       Express server (127.0.0.1:18765, POST /api/say-hello)
    ai/
      llmAdapter.ts  Runtime-agnostic LocalLlmAdapter/ToolDefinition contract
      zodToGbnf.ts   Converts a tool's Zod schema to node-llama-cpp's GBNF format
      model.ts       Resolves the GGUF model path; NodeLlamaCppAdapter (implements LocalLlmAdapter)
      tools.ts       The one say_hello LangChain tool (+ its ToolDefinition)
      agent.ts       LangGraph graph: conversation state + tool-calling turn
      toolEvents.ts  Tiny EventEmitter for live "tool started/finished" events
  preload/
    preload.ts       contextBridge.exposeInMainWorld("ai", { chat, onToolEvent })
  renderer/
    App.tsx           Chat UI, built on assistant-ui's Thread primitives
    transport.ts       Adapts useChat()'s ChatTransport to window.ai.chat()
    main.tsx
    styles.css         Tailwind entrypoint (@import "tailwindcss")
resources/
  models/
    model.gguf        ← you place the model file here (see "Model" below)
    adapter.gguf       ← optional LoRA adapter (see "Fine-tuning with LoRA")
finetune/               ← separate LoRA fine-tuning pipeline, see finetune/README.md
```

## Interactive chat & conversation state

The chat is a real, unlimited, back-and-forth conversation, not a one-shot
demo. Every user message goes through the same LangGraph app and the same
`LlamaChatSession`, both created once and reused for the life of the app:

- `agent.ts` compiles **one** `StateGraph` over `MessagesAnnotation` (a
  `messages: BaseMessage[]` state) with a `MemorySaver` checkpointer, keyed
  by a fixed `thread_id`. Every call to `sendMessage()` appends the new
  `HumanMessage` and lets the checkpointer restore everything said before it
  — so the graph's message history genuinely accumulates turn over turn.
- The actual token-level context the model reasons over is kept by the
  long-lived `LlamaChatSession` in `model.ts` (created lazily on the first
  message, then reused). Each new call sends only the newest user turn to
  `session.promptWithMeta()` — the session's own history already holds
  everything from earlier turns, exactly the way `LlamaChatSession` is
  designed to be used.
- After each turn, the resulting tool-call / tool-result / final-reply
  messages are appended back into the LangGraph state, so the state shown in
  section 6 of the spec (`user → tool_call → tool result → assistant text →
  next user turn`) is what's actually stored and returned to the UI.

Nothing is persisted to disk — this is in-memory, for the current app
session only, as required.

## Chat UI: `assistant-ui` primitives over Electron IPC, not hand-rolled

The renderer is built on `@assistant-ui/react`'s composable primitives
(`ThreadPrimitive`, `MessagePrimitive`, `ComposerPrimitive`) rather than a
hand-rolled `useState` reducer and hand-written bubble markup — message
list rendering, auto-scroll, the empty/running/error states, and the
composer's Enter-to-send + disabled-while-sending behavior all come from
the library, not from this app's code. `App.tsx` supplies Tailwind utility
classes for the visual styling; the interactive behavior is assistant-ui's.

This pulls in real dependencies the original spec's "no large UI framework"
guidance was written to avoid — `zustand` (assistant-ui's internal state
store), `radix-ui`, and Tailwind CSS — a deliberate, explicit tradeoff made
when asked for the "provided template" rather than more hand-rolled CSS.

Under the hood, assistant-ui's `useChatRuntime` (from `@assistant-ui/ai-sdk`)
wraps `@ai-sdk/react`'s `useChat()`, which is built around a `ChatTransport`
interface: give it something that takes the message history and returns a
`ReadableStream<UIMessageChunk>`, and it drives everything else (appending
messages, run status, error state). It normally expects an HTTP endpoint
that streams tokens back. This app has neither HTTP nor token-level
streaming — `window.ai.chat()` is one Electron IPC round trip that resolves
with the whole reply at once — so `src/renderer/transport.ts` implements a
small `ElectronIpcChatTransport` that:

1. Pulls the latest user message's text out of the `UIMessage[]` history
   it's handed (older turns aren't resent — the main process already
   remembers them, see above).
2. Calls `window.ai.chat(text)`, and while that call is in flight, listens
   for live tool-call events (see "Live tool-call status" below) and turns
   each one into a `tool-input-available` / `tool-output-available`
   `UIMessageChunk` as it happens.
3. Once `window.ai.chat()` resolves, appends the final reply as a
   `text-start`/`text-delta`/`text-end` chunk sequence and closes the
   stream — the runtime sees a normal completed turn assembled from one
   live event plus one blocking call, not real token-by-token streaming.

`transport.ts` (plus a small live-event bridge — see below) is the entire
integration surface between assistant-ui/`useChat()` and this app's IPC;
`agent.ts` and `server.ts` are unaware any of this exists.

## Tool → HTTP → Express flow

`say_hello` is a real `@langchain/core` tool built with `tool(...)` and a
Zod schema (`src/main/ai/tools.ts`). Its implementation performs an actual
`fetch()` POST to `http://127.0.0.1:18765/api/say-hello` — it does not touch
the console directly.

The model itself decides whether to call it. `agent.ts` doesn't talk to
`node-llama-cpp` at all — it calls `adapter.chat(text, allTools)` against
the `LocalLlmAdapter` interface (`llmAdapter.ts`); `model.ts`'s
`NodeLlamaCppAdapter` is the only place that knows this means
`session.promptWithMeta(text, { functions })` under the hood, using
`node-llama-cpp`'s own grammar-constrained function calling. This is a
GBNF-grammar-enforced mechanism, so the model can only ever emit a
syntactically valid function call or plain text — never a hallucinated
malformed call; the grammar itself is generated from `say_hello`'s Zod
schema via `zodToGbnf.ts` (using Zod's own `toJSONSchema()`), not a
hand-duplicated copy — `tools.ts` defines the schema exactly once. When the
model does call it, the adapter invokes the tool's `handler` (which is just
`sayHelloTool.invoke(params)`), feeds the JSON result back to the model,
and the model's follow-up text becomes the assistant reply shown in the
UI. There is no `if (message.includes("hello"))` anywhere in this
codebase.

Express (`src/main/server.ts`) binds only to `127.0.0.1:18765` and exposes
exactly one route, `POST /api/say-hello`, which logs `AI says: <message>` to
the Electron main-process console and replies `{ "success": true }`.

## Swapping the local LLM runtime: `LocalLlmAdapter`

`agent.ts` only depends on `llmAdapter.ts`'s `LocalLlmAdapter` interface —
`chat(userText, tools) => { toolCalls, responseText }` — not on
`node-llama-cpp` directly. `model.ts`'s `NodeLlamaCppAdapter` is the only
class that imports `node-llama-cpp` types or knows what `promptWithMeta`
or GBNF grammars are; `agent.ts` never sees them.

This wasn't the original shape of the code — earlier versions had
`agent.ts` calling `session.promptWithMeta()` and parsing
`node-llama-cpp`'s `ChatModelFunctionCall` result directly, which meant
swapping the local runtime (say, adding an Ollama or llama.cpp-server
adapter later) would have meant rewriting `agent.ts`, not just adding a new
file. It was refactored behind this interface specifically to fix that —
a second `LocalLlmAdapter` implementation is now a new class in a new
file; `agent.ts` doesn't change.

The same refactor removed a duplicated tool schema: `tools.ts` used to
define `say_hello`'s parameters twice — once as the Zod schema LangChain's
`tool()` needs, once as a hand-copied `GbnfJsonSchema` object for
`node-llama-cpp`'s function calling, kept in sync by hand. `zodToGbnf.ts`
now derives the second shape from the first automatically (via Zod's own
`toJSONSchema()`, stripping the one field `GbnfJsonSchema` doesn't
recognize) — `tools.ts` defines the schema once, and `allTools` is the one
place a second tool would be registered, picked up by any
`LocalLlmAdapter` implementation without further code changes.

## Live tool-call status (like a coding agent showing "running: …")

The UI shows `🔧 say_hello("Hello Jack!") — running…` the moment the tool
actually starts executing, flipping to `✅ … — done` once it completes —
not just the final text reply appearing after everything is over. This
uses two existing, standard mechanisms glued together, not a custom status
system:

- **AI SDK's tool-call protocol**: `UIMessageChunk` already has
  `tool-input-available` / `tool-output-available` chunk types for exactly
  this — a tool call in progress vs. completed, as a distinct message part
  alongside the text.
- **assistant-ui's tool-call rendering**: `MessagePrimitive.Content`'s
  render-prop form is called once per part; a part with
  `part.type === "tool-call"` carries `toolName`, `args`, `result`, and
  `status.type` (`"running"` → `"complete"`) — `App.tsx`'s `ToolCallStatus`
  component just reads those straight off the part.

The missing piece was *timing*: `window.ai.chat()` only resolves once the
whole turn (including the tool call) is done, so by itself it can't tell
the renderer "the tool just started." To get genuinely live updates:

1. `src/main/ai/toolEvents.ts` is a tiny `EventEmitter`. `tools.ts`'s
   `sayHelloTool` implementation emits a `tool-call-start` event right
   before its `fetch()` call and a `tool-call-end` event right after,
   carrying the same `toolCallId`.
2. `main.ts` subscribes once at startup and forwards every event to the
   renderer via `mainWindow.webContents.send("ai:tool-event", event)` — a
   push channel, separate from the `ai:chat` request/response `invoke()`.
3. `preload.ts` exposes this as `window.ai.onToolEvent(callback)`
   (returns an unsubscribe function), the only other thing added to the
   renderer's IPC surface.
4. `transport.ts` subscribes to `onToolEvent` for the duration of each
   `sendMessages()` call and enqueues the corresponding chunk into the same
   stream `useChat()` is reading from — see above.

Because `fetch()` inside `sayHelloTool` is real async I/O, the `tool-call-
start` event reaches the renderer (and repaints the status card) while
`node-llama-cpp` is still blocked inside `session.promptWithMeta()` waiting
for the HTTP round trip — this is genuinely live, not simulated with a
timer.

## Security boundary

The model has access to exactly one capability: `say_hello`. There is no
shell access, no filesystem access, no `child_process`, and no ability to
make arbitrary HTTP requests — the only network call the app ever makes is
the one hard-coded POST from `tools.ts` to the local Express server. The
renderer has no Node.js access at all (`contextIsolation: true`,
`nodeIntegration: false`); it only sees `window.ai.chat(message)`. There is
no `Content-Security-Policy` meta tag in `index.html` — a strict one breaks
Vite's dev-server HMR client — which is fine here since the renderer never
loads remote content; add one back for a hardened production build if
needed.

## Known limitations of tool calling with a small local model

- Native LangChain `.bindTools()` / LangGraph `ToolNode` require a chat
  model that implements LangChain's tool-calling interface.
  `@langchain/community`'s `ChatLlamaCpp` wrapper is a `SimpleChatModel`
  (plain text in/out) and does **not** implement that interface, so it
  can't be used with the standard `bindTools`/`ToolNode` pattern. This
  project uses `node-llama-cpp`'s own native, grammar-constrained function
  calling instead (see above), invoked from a single LangGraph node — this
  is native tool calling, just not routed through LangChain's `bindTools`
  abstraction. This is the documented, sanctioned fallback (see task spec
  §11) when the chosen small model/runtime doesn't support that specific
  LangChain interface.
- A 1–2B model is small. It can occasionally: ignore the instruction to
  call `say_hello` for an ambiguous greeting request, call it with an
  overly literal or slightly odd `message` string, or produce a terse final
  reply. Grammar-constrained function calling (used here) makes the *shape*
  of a tool call reliable; it does not make the model's *judgment* about
  when to call it perfect. A larger model (3B+) will be noticeably more
  consistent if this matters for your use case.
- Measured with Qwen2.5-1.5B-Instruct: requests phrased like the spec's own
  examples ("Say hello to Jack", "say hello to X") reliably triggered
  `say_hello` across many consecutive turns in the same session. A request
  phrased differently ("say **hi** to Alice" instead of "say **hello**")
  sometimes replied in plain text without calling the tool at all. The
  system prompt in `model.ts` was tuned by hand against this exact
  behavior — but tuning further in the *other* direction (a longer prompt
  with explicit examples) made things measurably worse, causing the model
  to stop calling the tool on every turn, including the ones that worked
  before. Small models are sensitive to prompt length/complexity in ways
  that don't generalize from "more explicit instructions = more reliable."
  If you hit this, prefer the exact "say hello to `<name>`" phrasing, or
  try a larger model. A second, smaller wording change was also tested —
  appending "...then briefly confirm the message was sent" to the same
  sentence, so the model would explicitly acknowledge success in its final
  reply (the tool's `{success: true}` result is already fed back to the
  model automatically; it just wasn't commenting on it) — and that single
  clause change was enough to make the model stop calling the tool on
  every turn again. It was reverted for that reason. At this model size,
  "explicitly confirm success afterwards" and "reliably call the tool in
  the first place" are in tension, and a 1.5B model doesn't reliably do
  both from a system-prompt instruction alone. Switching to
  **Qwen2.5-3B-Instruct**, with the exact same "...then briefly confirm the
  message was sent" system prompt, resolved this: every test turn (all four
  prompts above, including the "hi" phrasing) both called `say_hello`
  correctly and produced an explicit confirmation in the final reply (e.g.
  "Sent a greeting to Jack."). This is why the project uses a 3B model
  rather than a 1–2B one, even though the task's target range was 1–2B —
  see "Model" above. Qwen2.5-3B-Instruct was later swapped for
  **Llama-3.2-3B-Instruct** for licensing reasons unrelated to this testing
  (Qwen2.5-3B-Instruct's GGUF is non-commercial-only licensed; see "Model").
  Llama-3.2-3B-Instruct matched or beat Qwen's tool-call reliability (4/4,
  including the "hi" phrasing) but its final replies just repeat the
  greeting rather than explicitly confirming success — the two 3B models
  are not identical here, only both clearly better than the 1.5B model.
- `node-llama-cpp`'s automatic function-calling loop (call → feed result
  back → continue generating) happens inside a single `promptWithMeta()`
  call. This project represents that whole exchange as one LangGraph node
  rather than separate `agent`/`tools` graph nodes ping-ponging — the
  resulting message history looks the same either way, but the loop control
  itself is owned by `node-llama-cpp`, not by LangGraph edges.

## Installation (end users)

None of the following need to be installed to run the packaged app:

- Ollama
- Python
- Node.js
- Any other AI runtime

Everything (Electron, the `node-llama-cpp` native runtime, and the GGUF
model) is bundled into the app by the packaging step below.

## Model

Download a small instruction-tuned GGUF model and save it as:

```
resources/models/model.gguf
```

Used here: **Llama-3.2-3B-Instruct**, `Q4_K_M` quantization, from
`bartowski/Llama-3.2-3B-Instruct-GGUF` on Hugging Face (~1.9 GB).
`node-llama-cpp` auto-detects its chat template via the built-in
`Llama3_2LightweightChatWrapper`.

This project briefly used Qwen2.5-3B-Instruct instead (see "Known
limitations" below for the tool-calling reliability testing that led to
picking a 3B model over 1–2B). It was swapped to Llama-3.2-3B-Instruct
because **Qwen2.5-3B-Instruct's GGUF is licensed under the Qwen RESEARCH
LICENSE AGREEMENT — non-commercial use only** without a separate license
from Alibaba Cloud, while Llama-3.2-3B-Instruct's license (Meta's Llama 3.2
Community License) permits commercial use (a separate license is required
only above 700M monthly active users). GGUF model licenses are unrelated to
and vary independently of this project's npm package licenses (all MIT or
Apache-2.0) — always check the license of the *specific* model and size
you download; e.g. Qwen2.5-0.5B/1.5B/7B-Instruct are Apache-2.0, but
Qwen2.5-3B/72B-Instruct are not.

Tradeoff observed switching models: Llama-3.2-3B-Instruct calls
`say_hello` at least as reliably as Qwen2.5-3B-Instruct (4/4 test turns,
including a phrasing Qwen sometimes missed), but its final replies tend to
just repeat the greeting ("Hello Jack!") rather than explicitly confirm
success ("Sent a greeting to Jack.") the way Qwen2.5-3B-Instruct's did.
Tool execution itself is identical either way — this is purely the wording
of the assistant's final text. A 1–2B model (Qwen2.5-1.5B-Instruct,
Apache-2.0; Llama-3.2-1B-Instruct) remains a smaller, faster drop-in if
tool-call reliability matters less than footprint for your use case.

- **Development**: the app reads `resources/models/model.gguf` from the
  project root by default. Set `LOCAL_MODEL_PATH=/absolute/path/to/model.gguf`
  to point at a model stored elsewhere instead.
- **Production**: `electron-builder.yml`'s `extraResources` copies
  `resources/models/` to `Contents/Resources/models/` (macOS) outside the
  asar archive, and `model.ts` resolves it via `process.resourcesPath` at
  runtime, so the packaged app always finds it regardless of install
  location.

## Fine-tuning with LoRA

`finetune/` is a separate, developer-side pipeline (MLX for training on
Apple Silicon → convert to a GGUF LoRA adapter) for fine-tuning the model
with LoRA. The adapter is applied at runtime by `model.ts` — via
`LOCAL_LORA_PATH` in dev, or `resources/models/adapter.gguf` if present —
on top of the unmodified base GGUF; it is never merged into
`model.gguf`. See `finetune/README.md` for the full pipeline, the mlx-lm ↔
PEFT format conversion it required, and measured before/after output
proving the adapter actually changes generation (not just that it loads
without error).

## Development

Requires Node.js on the *development* machine (not needed by end users of
the packaged app).

```bash
npm install
npm run dev
```

`electron-vite dev` builds main/preload/renderer, launches Electron, and
gives you HMR for the renderer.

## Production packaging

```bash
npm run build       # electron-vite build → out/
npm run dist:mac     # packages a macOS (Apple Silicon) .dmg into release/
```

`dist:mac` targets `arm64` first, per the task priority on Apple Silicon.
The build is unsigned — fine for local testing; add a Developer ID identity
in `electron-builder.yml` if you need to distribute it.

## Verifying a real HTTP request was made

1. Run `npm run dev` and open the app.
2. Watch the terminal running `npm run dev` (that's the Electron main
   process console).
3. In the chat, type: `Say hello to Jack` and press Enter.
4. Once the assistant replies, check the terminal — you should see:
   ```
   AI says: Hello Jack
   ```
   printed by `server.ts`'s Express route handler, proving the model
   generated a tool call, `node-llama-cpp` invoked the LangChain tool, the
   tool performed a real `fetch()` POST, and Express received and logged it.
5. Optionally, run `curl -X POST http://127.0.0.1:18765/api/say-hello -H "Content-Type: application/json" -d '{"message":"manual test"}'`
   while the app is running to confirm the server is reachable at
   `127.0.0.1:18765` and responds `{"success":true}` — and that the same
   `AI says: manual test` line appears in the terminal.
6. Send a follow-up message, e.g. `Now say hello to Mary`, without
   restarting the app — the model should call `say_hello` again with a new
   message and the terminal should print a second, distinct `AI says: ...`
   line, confirming the conversation continues across turns.
