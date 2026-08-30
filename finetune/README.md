# Fine-tuning with LoRA

A pipeline to fine-tune the app's local model with LoRA and load the result
into the running Electron app as a **separate adapter, applied at
runtime** — the base GGUF in `resources/models/model.gguf` is never
modified. This has been run end-to-end (training, format conversion, and
loading into `node-llama-cpp`) and verified to actually change the model's
output, not just "load without crashing" — see "Verifying it actually
works" below.

This is developer-side tooling, run manually on your machine outside the
Electron app — it is not bundled into the packaged app, and using Python
here does not conflict with the app itself having no Python dependency.

## Why MLX

This is Apple Silicon hardware. [MLX](https://github.com/ml-explore/mlx)
(specifically [`mlx-lm`](https://github.com/ml-explore/mlx-lm)'s LoRA
support) trains natively on the machine's GPU, with no CUDA/`bitsandbytes`
(which barely works on macOS) and no separate training server.

## The pipeline

```
mlx_lm.lora --train              (finetune/scripts/train.sh)
        ↓
adapters/<name>/adapters.safetensors + adapter_config.json   (mlx-lm's own format)
        ↓
mlx_adapter_to_peft.py           (finetune/scripts/convert.sh, step 1)
        ↓
adapters/<name>-peft/            (Hugging Face PEFT format)
        ↓
llama.cpp's convert_lora_to_gguf.py   (finetune/scripts/convert.sh, step 2)
        ↓
adapters/<name>.gguf             (GGUF LoRA adapter)
        ↓
node-llama-cpp's context.lora    (model.ts, at runtime, unmodified base model)
```

Two separate stages exist because **mlx-lm and llama.cpp's official
converter disagree on the LoRA adapter format**, and there's no direct
mlx → GGUF LoRA path:

- **Tensor names.** mlx-lm saves `model.layers.N.<...>.lora_a` /
  `lora_b`. `convert_lora_to_gguf.py` only understands the Hugging Face
  PEFT layout: `base_model.model.model.layers.N.<...>.lora_A.weight` /
  `lora_B.weight` (capital A/B, `.weight` suffix, extra prefix).
- **Tensor orientation.** mlx-lm's `lora_a` is `(in_features, rank)` and
  `lora_b` is `(rank, out_features)` — shaped for `x @ A @ B`. PEFT's
  `lora_A.weight` is `(rank, in_features)` and `lora_B.weight` is
  `(out_features, rank)` — `nn.Linear` weight layout. Each is the
  **transpose** of the mlx-lm tensor with the same role. Getting this
  backwards produces an adapter that loads without error but is silently
  wrong (the delta gets applied to the wrong axis).
- **Scale.** mlx-lm applies its `scale` config value directly as the LoRA
  multiplier. PEFT computes its multiplier as `lora_alpha / r`. To get the
  same effective scale, `mlx_adapter_to_peft.py` sets
  `lora_alpha = scale * r`.

`mlx_adapter_to_peft.py` (run with `finetune/.venv`, which has `mlx`)
handles exactly these three translations and writes a PEFT-format
directory — nothing else. It deliberately writes plain numpy arrays via
`safetensors.numpy` rather than `torch.Tensor`s: safetensors is a
framework-agnostic file format, so the file it writes loads back fine via
`safetensors.torch.load_file` in the *other* venv, without needing torch
(and its numpy 2.x-incompatible pin) anywhere near mlx-lm.
`convert_lora_to_gguf.py` (run with `finetune/.venv-convert`, which has
`torch`/`transformers`/`gguf`) is llama.cpp's own, already-tested
converter — reused as-is rather than hand-writing a GGUF LoRA file writer,
which would also need to correctly replicate llama.cpp's
architecture-specific tensor-name mapping and RoPE weight permutation to
produce a correct (not just plausible-looking) adapter.

## Setup

```bash
finetune/scripts/setup.sh
```

Creates two Python virtualenvs (`finetune/.venv` for `mlx-lm`,
`finetune/.venv-convert` for llama.cpp's converter — kept separate because
they need incompatible `numpy` versions) and shallow-clones llama.cpp into
`finetune/vendor/llama.cpp` for `convert_lora_to_gguf.py`. All three are
gitignored; re-run this script instead of committing them.

## Data

`finetune/data/train.jsonl` and `finetune/data/valid.jsonl` are a small
sample dataset in mlx-lm's `tools` chat format, demonstrating the
`say_hello` tool call for varied phrasings ("say hello", "say hi", "greet",
"send a greeting"), plus a couple of plain-text examples so the model
doesn't learn to call the tool for everything. This is enough to prove the
pipeline end-to-end; it is not a rigorously sized dataset for a production
fine-tune. Add more examples in the same shape to actually target specific
reliability gaps (see the root README's "Known limitations" section for
the tool-calling behavior this could help with).

## Train

```bash
finetune/scripts/train.sh \
  --model Qwen/Qwen2.5-1.5B-Instruct \
  --adapter-path finetune/adapters/demo \
  --iters 30 --batch-size 2 --num-layers 8
```

Any extra flags are passed straight to `mlx_lm.lora`; see
`finetune/.venv/bin/mlx_lm.lora --help`. `--model` accepts any Hugging
Face repo `mlx-lm` supports (downloaded automatically) or a local path.

To fine-tune the model this app actually ships
(`Llama-3.2-3B-Instruct`), pass `--model meta-llama/Llama-3.2-3B-Instruct`.
That repo is **gated** on Hugging Face — you need an account with access
approved and to run `finetune/.venv/bin/huggingface-cli login` first. The
demo above intentionally uses Qwen2.5-1.5B-Instruct instead (ungated,
small, fast) so the pipeline can be verified without that extra step.

## Convert to GGUF

```bash
finetune/scripts/convert.sh demo Qwen/Qwen2.5-1.5B-Instruct
```

Produces `finetune/adapters/demo.gguf`. The second argument must be the
same base model the adapter was trained against — the LoRA delta only
makes sense applied to the same architecture and dimensions it was
computed from.

## Using the adapter in the app

Point the app at it for a dev run:

```bash
LOCAL_LORA_PATH=/absolute/path/to/finetune/adapters/demo.gguf npm run dev
```

Or drop it in permanently as `resources/models/adapter.gguf` (`model.ts`
picks it up automatically if present, alongside `resources/models/model.gguf`
— see the root README's "Model" section). **The adapter must match
whichever GGUF is at `resources/models/model.gguf`** — a LoRA trained
against Qwen2.5-1.5B will not load correctly against the shipped
Llama-3.2-3B-Instruct base, and vice versa.

## Verifying it actually works

`finetune/scripts/test-lora-load.mjs` loads a base GGUF twice — once
plain, once with the LoRA adapter attached — and generates from the same
prompt both times, so you can see the adapter actually changed the output
(not just that it loaded without throwing):

```bash
node finetune/scripts/test-lora-load.mjs
```

(Edit the `BASE_MODEL`/`LORA_ADAPTER` constants at the top of the file to
point at whatever base GGUF + adapter you want to check — by default it
expects a Qwen2.5-1.5B-Instruct GGUF at `finetune/test-base/` and the demo
adapter above.)

Measured result from the actual demo run (`say hi to Nancy`, no tool
grammar attached, to isolate the effect on plain text):

```
=== WITHOUT LoRA ===
Hello Nancy! How are you today?

=== WITH LoRA (trained on say_hello examples) ===
Hello Nancy!
```

The output shifted toward the short, greeting-only style the training data
uses — a real, visible effect (not a silently inert or corrupted adapter).
Running the same prompt through the full app (`main.ts` → `agent.ts` →
`model.ts`, `LOCAL_LORA_PATH` pointed at `demo.gguf`) confirmed the
`say_hello` tool call still fires correctly on top of the adapter:

```
Loaded LoRA adapter: .../finetune/adapters/demo.gguf
AI says: Hi Nancy! How are you today?
REPLY: Hello Nancy!
```
