# Jev vs Laya — Chess Head-to-Head Bench

Tony Dinh-style System One bench, but for **chess**: players only see **legal UCI moves** as Choice criteria (keys = UCI, capped at 255). Scoreboard prints W/D/L, avg ms/move, p50, and illegal count (should stay **0**).

Players:

| Name | Backend |
|------|---------|
| `jev` | TypeSafe hosted System One — `POST https://api.typesafe.ai/v1/systemone`, model `jev-latest`, Bearer `$TYPESAFE_API_KEY` |
| `laya` | Open upstream System One — `pip install laya`, `laya.load("convaiinnovations/laya")` (~808 MB English checkpoint) |
| `random` | Uniform random legal move (offline demos / tests) |

State sent to models: FEN + side to move (+ ply metadata). Questions: a single `choice` named `move` with UCI keys and SAN descriptions.

## Live demo (GitHub Pages)

Interactive board viewer (dark desktop UI, replay + HUD):

**https://abe17124.github.io/jev-laya-chess-bench/**

Embedded demos (static JSON under `docs/data/`):

- **Laya vs Random** — System One Laya opening vs uniform random (latency + top-N probs)
- **Random vs Random** — decisive checkmate (seed 7, 29 plies)

Source lives in `docs/` (GitHub Pages from `/docs` on `main`). No backend, no API keys.

## Install

```bash
cd jev-laya-chess-bench
python3 -m venv .venv
source .venv/bin/activate
pip install -U pip
pip install -e ".[dev]"
# Optional Laya (heavy: torch + transformers + ~808 MB weights on first run):
# pip install -e ".[laya]"
```

Set the TypeSafe key for Jev (never commit it):

```bash
export TYPESAFE_API_KEY=...   # length > 0 required
```

## Run

```bash
# Offline smoke
python -m chess_bench.cli --games 1 --white random --black random --seed 42 \
  --show-board --html-dir artifacts/html --out artifacts/random_vs_random.json

# Jev vs random (needs TYPESAFE_API_KEY)
python -m chess_bench.cli --games 1 --white jev --black random --seed 7 \
  --show-board --html-dir artifacts/html --out artifacts/jev_vs_random.json

# Head-to-head Jev vs Laya (colors alternate across games)
python -m chess_bench.cli --games 4 --white jev --black laya --seed 1 \
  --html-dir artifacts/html --out artifacts/jev_vs_laya.json

# pytest smoke
pytest -q
```

Useful flags:

- `--games N` — number of games
- `--white` / `--black` — `jev` | `laya` | `random`
- `--seed` — RNG seed for `random`
- `--out results.json` — full JSON dump (scoreboard + plies)
- `--html-dir DIR` — per-game HTML with move list + latency (screen-record friendly)
- `--show-board` — print unicode board every ply
- `--no-alternate` — keep fixed colors instead of swapping each game
- `--max-plies 400` — safety cap

## Scoreboard

After each game and at the end:

```
═══ FINAL SCOREBOARD ═══
Player         W   D   L    avg ms   p50 ms  illegal
--------------------------------------------------------
jev            1   0   0     240.0    230.0        0
random         0   0   1       0.0      0.0        0
```

Illegal count must stay 0: the runner only offers legal UCI options, and any off-list Choice is counted as illegal (and loses the game).

## Project layout

```
chess_bench/
  players/          # jev, laya, random + Choice helpers
  match.py          # game + match runner
  scoreboard.py     # W/D/L + latency stats
  visual.py         # terminal board + HTML export
  cli.py            # argparse entrypoint
tests/
  test_random_vs_random.py
```


## Notes

Once `TYPESAFE_API_KEY` is exported, run:

```bash
source .venv/bin/activate
python -m chess_bench.cli --games 1 --white jev --black random --seed 7 \
  --show-board --html-dir artifacts/html --out artifacts/jev_vs_random.json
```

## Blockers / caveats

- **Jev** requires `TYPESAFE_API_KEY` in the environment of the process. The CLI never prints the key; it only reports whether it is set/missing.
- **Laya** is optional. Installing `laya` pulls PyTorch + Transformers and downloads ~808 MB on first `laya.load(...)`. If the download or GPU/CPU memory is too heavy for the host, use `random` for demos; the `LayaPlayer` adapter is still shipped and fails with a clear error.
- Chess legal-move cardinality is well under the Choice limit of 255; the bench still truncates defensively.

## License

Apache-2.0 for this harness. Jev is a hosted TypeSafe service; Laya weights are Apache-2.0 (Convai Innovations).
