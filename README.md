# JEV vs LAYA — chess

Head-to-head chess bench: **Jev** (TypeSafe API) vs **Laya** (open checkpoint). Legal UCI moves only. Scoreboard: W/D/L, avg ms, p50, illegal count.

## Live demo

**https://abe17124.github.io/jev-laya-chess-bench/**

Jev vs Laya match replay (static JSON under `docs/data/jev_vs_laya.json`). No API keys in the page.

## Install

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev,laya]"
export TYPESAFE_API_KEY=...   # required for Jev; never commit
```

## Run

```bash
python -m chess_bench.cli --games 2 --white jev --black laya --seed 1 \
  --max-plies 80 --html-dir artifacts/html --out artifacts/jev_vs_laya.json --show-board
```

Colors alternate across games by default (`--no-alternate` to fix).

Players: `jev` | `laya` | `random`.

## License

Apache-2.0 for this harness. Jev is a hosted TypeSafe service; Laya weights are Apache-2.0 (Convai Innovations).
