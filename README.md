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
      model.ts      Resolves the GGUF model path, owns the LlamaChatSession
      tools.ts       The one say_hello LangChain tool (+ its function definition)
      agent.ts       LangGraph graph: conversation state + tool-calling turn
  preload/
    preload.ts       contextBridge.exposeInMainWorld("ai", { chat })
  renderer/
    App.tsx           Chat UI, built on assistant-ui's Thread primitives
    transport.ts       Adapts useChat()'s ChatTransport to window.ai.chat()
    main.tsx
    styles.css         Tailwind entrypoint (@import "tailwindcss")
resources/
  models/
    model.gguf        ← you place the model file here (see "Model" below)
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
2. Calls `window.ai.chat(text)` and awaits the single reply string.
3. Wraps that string as a minimal-but-valid `UIMessageChunk` stream
   (`start` → `text-start`/`text-delta`/`text-end` → `finish`) so the
   runtime sees a normal completed turn — it just arrives all at once
   instead of token-by-token.

None of `main.ts`, `preload.ts`, `server.ts`, or `agent.ts` changed for
this — `transport.ts` is the entire integration surface, unchanged from the
plain-`useChat()` version that preceded assistant-ui.

## Tool → HTTP → Express flow

`say_hello` is a real `@langchain/core` tool built with `tool(...)` and a
Zod schema (`src/main/ai/tools.ts`). Its implementation performs an actual
`fetch()` POST to `http://127.0.0.1:18765/api/say-hello` — it does not touch
the console directly.

The model itself decides whether to call it: `agent.ts` passes the tool to
`node-llama-cpp`'s own grammar-constrained function calling
(`session.promptWithMeta(text, { functions: { say_hello } })`). This is a
GBNF-grammar-enforced mechanism, so the 1–2B model can only ever emit a
syntactically valid function call or plain text — never a hallucinated
malformed call. When the model does call it, `node-llama-cpp` invokes the
handler (which is just `sayHelloTool.invoke(params)`), feeds the JSON result
back to the model, and the model's follow-up text becomes the assistant
reply shown in the UI. There is no `if (message.includes("hello"))` anywhere
in this codebase.

Express (`src/main/server.ts`) binds only to `127.0.0.1:18765` and exposes
exactly one route, `POST /api/say-hello`, which logs `AI says: <message>` to
the Electron main-process console and replies `{ "success": true }`.

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
