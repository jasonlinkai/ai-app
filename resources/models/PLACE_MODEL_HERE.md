# Model file goes here

Download a small instruction-tuned GGUF model and save it in this folder
as:

```
resources/models/model.gguf
```

**Used in this project: Llama-3.2-3B-Instruct**, `Q4_K_M` GGUF quantization
(~1.9 GB), from `bartowski/Llama-3.2-3B-Instruct-GGUF` on Hugging Face —
save `Llama-3.2-3B-Instruct-Q4_K_M.gguf` as `resources/models/model.gguf`.

## Why this model, and not Qwen2.5-3B-Instruct

An earlier version of this project used Qwen2.5-3B-Instruct, which had
excellent tool-calling reliability and explicit success confirmations (see
the root README's "Known limitations" section for the testing history).
It was swapped out because **Qwen2.5-3B-Instruct's GGUF is licensed under
the Qwen RESEARCH LICENSE AGREEMENT — non-commercial use only** without a
separate license from Alibaba Cloud. Llama-3.2-3B-Instruct's license (Meta's
"Llama 3.2 Community License") permits commercial use (a separate license
is only required above 700M monthly active users, which is not a concern
for essentially any real deployment).

Tradeoff observed in testing: Llama-3.2-3B-Instruct calls `say_hello` at
least as reliably as Qwen2.5-3B-Instruct did (4/4 test turns, including
phrasing Qwen sometimes missed), but its final replies tend to just repeat
the greeting (e.g. "Hello Jack!") rather than explicitly confirming success
("Sent a greeting to Jack.") the way Qwen2.5-3B-Instruct's replies did. Tool
execution itself is unaffected either way — this is purely about the
wording of the assistant's final text.

node-llama-cpp auto-detects Llama 3.2's chat template via the built-in
`Llama3_2LightweightChatWrapper`, no code changes needed.

## License check before swapping models

GGUF model licenses are separate from the npm package licenses in this
project (all of which are MIT or Apache-2.0) and vary a lot by model and
even by size within the same model family:

- **Apache-2.0** (fully permissive): Qwen2.5-0.5B/1.5B/7B-Instruct
- **Non-commercial only**: Qwen2.5-3B-Instruct, Qwen2.5-72B-Instruct (Qwen
  Research License)
- **Commercial-friendly with conditions**: the Llama 3.2 family (Meta's
  community license; a paid license is required only above 700M MAU)

Always check the specific model+size you're downloading — check.md files
or `license` field in the Hugging Face model's `README.md`/model card
before assuming a model from a permissively-licensed family is itself
permissively licensed.

This placeholder file is not read by the app. Real `.gguf` files are
gitignored — they are too large to commit.
