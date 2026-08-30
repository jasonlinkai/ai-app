#!/usr/bin/env bash
# Converts an mlx-lm LoRA adapter into a GGUF LoRA adapter node-llama-cpp can
# load at runtime (see model.ts's LOCAL_LORA_PATH / resources/models/adapter.gguf).
#
# Usage:
#   finetune/scripts/convert.sh <adapter_name> <base_model_hf_id>
#
# Example:
#   finetune/scripts/convert.sh demo Qwen/Qwen2.5-1.5B-Instruct
#
# Reads finetune/adapters/<adapter_name>/ (mlx-lm's output) and writes:
#   finetune/adapters/<adapter_name>-peft/   (intermediate PEFT-format adapter)
#   finetune/adapters/<adapter_name>.gguf    (final GGUF LoRA adapter)
set -euo pipefail
cd "$(dirname "$0")/../.."

adapter_name="${1:?Usage: convert.sh <adapter_name> <base_model_hf_id>}"
base_model_id="${2:?Usage: convert.sh <adapter_name> <base_model_hf_id>}"

mlx_dir="finetune/adapters/${adapter_name}"
peft_dir="finetune/adapters/${adapter_name}-peft"
gguf_out="finetune/adapters/${adapter_name}.gguf"

finetune/.venv/bin/python finetune/scripts/mlx_adapter_to_peft.py "$mlx_dir" "$peft_dir"

finetune/.venv-convert/bin/python finetune/vendor/llama.cpp/convert_lora_to_gguf.py \
  --base-model-id "$base_model_id" \
  --outfile "$gguf_out" \
  "$peft_dir"

echo "GGUF LoRA adapter written to $gguf_out"
