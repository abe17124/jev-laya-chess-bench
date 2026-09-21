#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
source .venv/bin/activate
python -m chess_bench.cli --games 1 --white random --black random --seed 42 \
  --show-board --html-dir artifacts/html --out artifacts/random_vs_random.json
