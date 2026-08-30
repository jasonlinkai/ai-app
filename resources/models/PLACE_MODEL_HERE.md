# Model file goes here

Download a small instruction-tuned GGUF model and save it in this folder
as:

```
resources/models/model.gguf
```

**Used in this project: Qwen2.5-3B-Instruct**, `Q4_K_M` GGUF quantization
(~2.1 GB), from `Qwen/Qwen2.5-3B-Instruct-GGUF` on Hugging Face (the
official Qwen org) — save `qwen2.5-3b-instruct-q4_k_m.gguf` as
`resources/models/model.gguf`.

Bumped up from Qwen2.5-1.5B-Instruct after hands-on testing: at 1.5B, the
model could reliably call the `say_hello` tool *or* reliably confirm
success afterwards in its reply, but not both from the same system prompt
— any wording tuned to make it do one made it stop doing the other. The 3B
model does both consistently. See the root README's "Known limitations"
section for the actual test data behind this.

node-llama-cpp auto-detects Qwen's chat template via the built-in
`QwenChatWrapper`, no code changes needed. Any similarly-shaped instruct
GGUF model works as a drop-in replacement (smaller ones like
Qwen2.5-1.5B-Instruct or Llama-3.2-1B-Instruct will run faster but less
reliably for this tool-calling demo, per the README).

This file is a placeholder so the folder exists in the repository; it is
not read by the app. Real `.gguf` files are gitignored — they are too
large to commit.
