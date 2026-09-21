"""CLI: chess-bench --games N --white jev|laya|random --black ..."""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from chess_bench.players import PLAYER_NAMES, make_player
from chess_bench.match import run_match, save_results


def _env_key_status() -> str:
    key = os.environ.get("TYPESAFE_API_KEY", "")
    return "set" if len(key) > 0 else "missing"


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="chess-bench",
        description="Head-to-head chess bench: TypeSafe Jev vs Laya (legal-move Choice).",
    )
    p.add_argument("--games", type=int, default=1, help="Number of games (default: 1)")
    p.add_argument(
        "--white",
        choices=PLAYER_NAMES,
        default="random",
        help="White player",
    )
    p.add_argument(
        "--black",
        choices=PLAYER_NAMES,
        default="random",
        help="Black player",
    )
    p.add_argument("--seed", type=int, default=None, help="RNG seed (random player)")
    p.add_argument("--out", type=str, default="results.json", help="JSON results path")
    p.add_argument(
        "--html-dir",
        type=str,
        default=None,
        help="Directory for per-game HTML exports (move list + latency)",
    )
    p.add_argument(
        "--show-board",
        action="store_true",
        help="Print unicode board after each ply",
    )
    p.add_argument(
        "--max-plies",
        type=int,
        default=400,
        help="Safety cap on plies per game (default: 400)",
    )
    p.add_argument(
        "--no-alternate",
        action="store_true",
        help="Do not swap colors across games",
    )
    p.add_argument(
        "--jev-model",
        type=str,
        default="jev-latest",
        help="TypeSafe model id (default: jev-latest)",
    )
    p.add_argument(
        "--laya-repo",
        type=str,
        default="convaiinnovations/laya",
        help="Hugging Face repo for Laya checkpoint",
    )
    p.add_argument(
        "--laya-device",
        type=str,
        default=None,
        help="Optional device for Laya (e.g. cpu, cuda)",
    )
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    if "jev" in (args.white, args.black) and _env_key_status() == "missing":
        print(
            "WARNING: TYPESAFE_API_KEY is not set; Jev moves will be marked illegal.",
            file=sys.stderr,
        )

    def white_factory():
        return make_player(
            args.white,
            seed=args.seed,
            model=args.jev_model,
            laya_repo=args.laya_repo,
            laya_device=args.laya_device,
        )

    def black_factory():
        # Offset seed so black random differs from white when both are random.
        seed = None if args.seed is None else args.seed + 1
        return make_player(
            args.black,
            seed=seed,
            model=args.jev_model,
            laya_repo=args.laya_repo,
            laya_device=args.laya_device,
        )

    html_dir = Path(args.html_dir) if args.html_dir else None
    payload = run_match(
        white_factory,
        black_factory,
        games=args.games,
        alternate_colors=not args.no_alternate,
        seed=args.seed,
        max_plies=args.max_plies,
        show_board=args.show_board,
        html_dir=html_dir,
    )
    payload["cli"] = {
        "white": args.white,
        "black": args.black,
        "typesafe_api_key": _env_key_status(),
    }
    save_results(payload, args.out)
    print(f"Wrote {args.out}")
    if html_dir:
        print(f"HTML games in {html_dir}/")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
