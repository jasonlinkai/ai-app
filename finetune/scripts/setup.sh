#!/usr/bin/env bash
# One-time setup for the fine-tune pipeline. Safe to re-run.
set -euo pipefail
cd "$(dirname "$0")/../.."

if [ ! -d finetune/.venv ]; then
  python3 -m venv finetune/.venv
fi
finetune/.venv/bin/pip install -q -U pip
finetune/.venv/bin/pip install -q "mlx-lm[train]" safetensors

if [ ! -d finetune/.venv-convert ]; then
  python3 -m venv finetune/.venv-convert
fi
finetune/.venv-convert/bin/pip install -q -U pip
finetune/.venv-convert/bin/pip install -q \
  "numpy~=1.26.4" "sentencepiece>=0.1.98,<0.3.0" "transformers==4.57.6" \
  "gguf>=0.1.0" "protobuf>=4.21.0,<5.0.0" safetensors
# A version <2.3 is used deliberately: llama.cpp's requirements file pins a
# much newer torch that needs Python 3.10+. This script only needs torch to
# load/save tensors (no training happens here), so any recent CPU build works.
finetune/.venv-convert/bin/pip install -q --extra-index-url https://download.pytorch.org/whl/cpu "torch<2.3"

if [ ! -d finetune/vendor/llama.cpp ]; then
  mkdir -p finetune/vendor
  git clone --depth 1 --filter=blob:none https://github.com/ggml-org/llama.cpp.git finetune/vendor/llama.cpp
fi

echo "Setup complete."
