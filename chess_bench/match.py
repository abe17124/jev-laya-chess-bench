"""Match runner: play N games, alternate colors, record plies + latency."""

from __future__ import annotations

import json
from dataclasses import asdict
from pathlib import Path
from typing import Any, Callable

import chess

from chess_bench.players.base import MoveDecision, Player
from chess_bench.scoreboard import PlayerStats, empty_stats, format_scoreboard
from chess_bench.visual import export_game_html, render_terminal_board


OnPly = Callable[[dict[str, Any], chess.Board, MoveDecision], None]


def play_game(
    white: Player,
    black: Player,
    *,
    max_plies: int = 400,
    show_board: bool = False,
    on_ply: OnPly | None = None,
) -> dict[str, Any]:
    board = chess.Board()
    plies: list[dict[str, Any]] = []
    players = {chess.WHITE: white, chess.BLACK: black}

    while not board.is_game_over(claim_draw=True) and board.ply() < max_plies:
        player = players[board.turn]
        decision = player.choose(board)
        legal = {m.uci() for m in board.legal_moves}
        uci = decision.move_uci
        illegal = decision.illegal or (uci not in legal)

        san = ""
        if not illegal and uci in legal:
            move = chess.Move.from_uci(uci)
            san = board.san(move)
            board.push(move)
        else:
            # Count as illegal; end the game as a loss for the mover.
            illegal = True
            decision.illegal = True
            if not decision.error:
                decision.error = "illegal or missing move"

        ply_rec = {
            "ply": board.ply() if not illegal else board.ply() + 1,
            "player": player.name,
            "color": "white" if player is white else "black",
            "uci": uci,
            "san": san,
            "latency_ms": decision.latency_ms,
            "confidence": decision.confidence,
            "probabilities": decision.probabilities,
            "illegal": illegal,
            "error": decision.error,
            "fen_after": board.fen() if not illegal else board.fen(),
            "fen": board.fen() if not illegal else board.fen(),
        }
        plies.append(ply_rec)

        if show_board and not illegal:
            print(render_terminal_board(board, last_uci=uci))
        if on_ply:
            on_ply(ply_rec, board, decision)

        if illegal:
            # Side that played illegally loses.
            result = "0-1" if player is white else "1-0"
            return {
                "white": white.name,
                "black": black.name,
                "result": result,
                "termination": "illegal_move",
                "final_fen": board.fen(),
                "plies": plies,
            }

    outcome = board.outcome(claim_draw=True)
    if outcome is None:
        result = "1/2-1/2"
        termination = "max_plies"
    else:
        result = outcome.result()
        termination = outcome.termination.name if outcome.termination else "unknown"

    return {
        "white": white.name,
        "black": black.name,
        "result": result,
        "termination": termination,
        "final_fen": board.fen(),
        "plies": plies,
    }


def run_match(
    white_factory: Callable[[], Player],
    black_factory: Callable[[], Player],
    *,
    games: int = 1,
    alternate_colors: bool = True,
    seed: int | None = None,
    max_plies: int = 400,
    show_board: bool = False,
    html_dir: Path | None = None,
) -> dict[str, Any]:
    """
    Play `games` games. When alternate_colors and the two sides differ,
    swap colors each game (Tony-style head-to-head).
    """
    # Probe names without holding long-lived remote clients if factories recreate.
    w0 = white_factory()
    b0 = black_factory()
    name_a = w0.name
    name_b = b0.name
    same_backend = name_a == name_b
    for p in (w0, b0):
        p.close()

    def seat_label(player: Player, color: str) -> str:
        if same_backend:
            return f"{player.name}/{color[0].upper()}"
        return player.name

    initial = (
        [f"{name_a}/W", f"{name_b}/B"] if same_backend else [name_a, name_b]
    )
    # Deduplicate while preserving order
    seen: list[str] = []
    for n in initial:
        if n not in seen:
            seen.append(n)
    stats = empty_stats(seen)
    game_records: list[dict[str, Any]] = []

    for i in range(games):
        swap = alternate_colors and (not same_backend) and (i % 2 == 1)
        if swap:
            white, black = black_factory(), white_factory()
        else:
            white, black = white_factory(), black_factory()

        w_key = seat_label(white, "white")
        b_key = seat_label(black, "black")

        print(f"\n── Game {i + 1}/{games}: {white.name} (W) vs {black.name} (B) ──")
        game = play_game(white, black, max_plies=max_plies, show_board=show_board)
        game["game_index"] = i
        game["seed"] = seed
        game["white_key"] = w_key
        game["black_key"] = b_key
        # Rewrite ply player keys for scoreboard when self-play
        if same_backend:
            for ply in game["plies"]:
                ply["player"] = w_key if ply["color"] == "white" else b_key
        game_records.append(game)

        for key in (w_key, b_key):
            if key not in stats:
                stats[key] = PlayerStats(name=key)
        if game["result"] == "1-0":
            stats[w_key].wins += 1
            stats[b_key].losses += 1
        elif game["result"] == "0-1":
            stats[b_key].wins += 1
            stats[w_key].losses += 1
        else:
            stats[w_key].draws += 1
            stats[b_key].draws += 1
        for ply in game["plies"]:
            st = stats[ply["player"]]
            st.record_latency(float(ply["latency_ms"]))
            if ply.get("illegal"):
                st.illegal_count += 1

        print(f"Result: {game['result']} ({game['termination']})")
        print(format_scoreboard(stats, title=f"After game {i + 1}"))

        if html_dir is not None:
            html_dir.mkdir(parents=True, exist_ok=True)
            export_game_html(game, html_dir / f"game_{i + 1:03d}.html")

        white.close()
        black.close()

    payload = {
        "games": games,
        "seed": seed,
        "alternate_colors": alternate_colors,
        "scoreboard": {n: st.summary() for n, st in stats.items()},
        "games_detail": game_records,
    }
    print(format_scoreboard(stats, title="FINAL SCOREBOARD"))
    return payload


def save_results(payload: dict[str, Any], path: str | Path) -> None:
    Path(path).write_text(json.dumps(payload, indent=2), encoding="utf-8")
