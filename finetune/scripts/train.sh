#!/usr/bin/env bash
# Fine-tunes a base model with LoRA using mlx-lm on the data in finetune/data.
#
# Usage:
#   finetune/scripts/train.sh [mlx_lm.lora args...]
#
# Example (the demo run this pipeline was proven with):
#   finetune/scripts/train.sh \
#     --model Qwen/Qwen2.5-1.5B-Instruct \
#     --adapter-path finetune/adapters/demo \
#     --iters 30 --batch-size 2 --num-layers 8
#
# To fine-tune the model this app actually ships (Llama-3.2-3B-Instruct),
# pass --model meta-llama/Llama-3.2-3B-Instruct — note this repo is gated on
# Hugging Face, so you'll need `huggingface-cli login` with an account that
# has been granted access first.
set -euo pipefail
cd "$(dirname "$0")/../.."

finetune/.venv/bin/python -m mlx_lm lora \
  --train \
  --data finetune/data \
  "$@"
