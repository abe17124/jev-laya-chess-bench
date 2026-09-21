# JEV vs LAYA — chess

Head-to-head chess bench: **Jev** (TypeSafe API) vs **Laya** (open checkpoint). Legal UCI moves only. Scoreboard: W/D/L, avg ms, p50, illegal count.

## Live demo (recommended)

GitHub Pages is **static** — it cannot call TypeSafe or run Laya. For a **live** Play button (new Jev vs Laya game every press), run the API on a machine that has the key + Laya weights:

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev,laya]"
export TYPESAFE_API_KEY=...   # required; never commit / never log
python -m chess_bench.server   # http://127.0.0.1:8787 — UI + /api
```

- `GET /health`
- `GET /api/game/stream?white=jev|laya` — SSE: each ply as JSON (`ply`, `player`, `color`, `uci`, `san`, `fen`, `latency_ms`, …)
- Same process serves `docs/` at `/` so one URL is the whole product.

Tunnel for a public HTTPS URL (example):

```bash
cloudflared tunnel --url http://127.0.0.1:8787
```

Optional: set `window.BENCH_API` in `docs/config.js` if the UI is hosted elsewhere (e.g. Pages) and the API is on another origin.

**Static Pages** (replay only): https://abe17124.github.io/jev-laya-chess-bench/

## CLI match (offline / batch)

```bash
python -m chess_bench.cli --games 2 --white jev --black laya --seed 1 \
  --max-plies 80 --html-dir artifacts/html --out artifacts/jev_vs_laya.json --show-board
```

Players: `jev` | `laya` | `random`.

## License

Apache-2.0 for this harness. Jev is a hosted TypeSafe service; Laya weights are Apache-2.0 (Convai Innovations).
