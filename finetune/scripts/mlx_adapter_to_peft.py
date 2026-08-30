#!/usr/bin/env python3
"""Convert an mlx-lm LoRA adapter directory into a PEFT-format adapter
directory, so llama.cpp's convert_lora_to_gguf.py (which only understands
the Hugging Face PEFT layout) can turn it into a GGUF LoRA adapter.

mlx-lm and PEFT disagree on two things for the same LoRA math:
  - Tensor names: mlx-lm saves "model.layers.N.<...>.lora_a" / "lora_b";
    PEFT expects "base_model.model.model.layers.N.<...>.lora_A.weight" /
    "lora_B.weight" (capital A/B, ".weight" suffix, extra prefix).
  - Tensor orientation: mlx-lm's lora_a is (in_features, rank) and lora_b is
    (rank, out_features) — the shapes PyTorch's `x @ A @ B` needs. PEFT's
    lora_A.weight is (rank, in_features) and lora_B.weight is
    (out_features, rank) — nn.Linear weight layout, i.e. each is the
    transpose of the mlx-lm tensor with the same role.
  - Scale: mlx-lm applies its "scale" value directly as the LoRA
    multiplier. PEFT computes its multiplier as lora_alpha / r. To get the
    same effective scale, this script sets lora_alpha = scale * r.

Usage:
    python mlx_adapter_to_peft.py <mlx_adapter_dir> <peft_output_dir>
"""

import argparse
import json
import sys
from pathlib import Path

import mlx.core as mx
import numpy as np
from safetensors.numpy import save_file


def convert(mlx_adapter_dir: Path, peft_output_dir: Path) -> None:
    config_path = mlx_adapter_dir / "adapter_config.json"
    weights_path = mlx_adapter_dir / "adapters.safetensors"
    if not config_path.exists() or not weights_path.exists():
        sys.exit(f"Expected {config_path} and {weights_path} to exist.")

    with open(config_path) as f:
        mlx_config = json.load(f)

    if mlx_config.get("fine_tune_type", "lora") != "lora":
        sys.exit(
            f"Only fine_tune_type=lora is supported by this script, "
            f"got {mlx_config.get('fine_tune_type')!r} (dora/full are not)."
        )

    rank = mlx_config["lora_parameters"]["rank"]
    scale = mlx_config["lora_parameters"]["scale"]
    lora_alpha = scale * rank

    mlx_weights = mx.load(str(weights_path))

    pairs: dict[str, dict[str, mx.array]] = {}
    for name, tensor in mlx_weights.items():
        if name.endswith(".lora_a"):
            pairs.setdefault(name[: -len(".lora_a")], {})["a"] = tensor
        elif name.endswith(".lora_b"):
            pairs.setdefault(name[: -len(".lora_b")], {})["b"] = tensor
        else:
            print(f"Skipping unrecognized tensor (not plain LoRA): {name}", file=sys.stderr)

    # safetensors is a framework-agnostic on-disk format: writing these as
    # plain numpy arrays here is fine even though convert_lora_to_gguf.py
    # (run separately, with torch) reads the file back with
    # safetensors.torch.load_file — no torch needed in this script/venv.
    peft_weights: dict[str, np.ndarray] = {}
    for module_path, ab in pairs.items():
        if "a" not in ab or "b" not in ab:
            sys.exit(f"Incomplete LoRA pair for {module_path}: {list(ab.keys())}")

        # mlx-lm: lora_a (in, r), lora_b (r, out) -> PEFT: lora_A (r, in), lora_B (out, r)
        lora_a = np.ascontiguousarray(np.array(ab["a"], copy=True).T)
        lora_b = np.ascontiguousarray(np.array(ab["b"], copy=True).T)

        prefixed = f"base_model.model.{module_path}"
        peft_weights[f"{prefixed}.lora_A.weight"] = lora_a
        peft_weights[f"{prefixed}.lora_B.weight"] = lora_b

    peft_output_dir.mkdir(parents=True, exist_ok=True)
    save_file(peft_weights, str(peft_output_dir / "adapter_model.safetensors"))

    target_modules = sorted({path.rsplit(".", 1)[-1] for path in pairs})
    peft_config = {
        "peft_type": "LORA",
        "task_type": "CAUSAL_LM",
        "base_model_name_or_path": mlx_config["model"],
        "r": rank,
        "lora_alpha": lora_alpha,
        "lora_dropout": mlx_config["lora_parameters"].get("dropout", 0.0),
        "target_modules": target_modules,
        "bias": "none",
        "fan_in_fan_out": False,
    }
    with open(peft_output_dir / "adapter_config.json", "w") as f:
        json.dump(peft_config, f, indent=2)

    print(f"Wrote {len(peft_weights)} tensors ({len(pairs)} LoRA layers) to {peft_output_dir}")
    print(f"rank={rank} mlx_scale={scale} -> peft lora_alpha={lora_alpha}")
    print(f"base_model_name_or_path={mlx_config['model']}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("mlx_adapter_dir", type=Path, help="Directory produced by mlx_lm.lora (contains adapters.safetensors)")
    parser.add_argument("peft_output_dir", type=Path, help="Directory to write the PEFT-format adapter into")
    args = parser.parse_args()
    convert(args.mlx_adapter_dir, args.peft_output_dir)
