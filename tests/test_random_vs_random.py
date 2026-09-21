"""Smoke: random vs random completes a game with zero illegal moves."""

from __future__ import annotations

from chess_bench.match import play_game
from chess_bench.players import RandomPlayer
from chess_bench.visual import export_game_html


def test_random_vs_random_completes(tmp_path):
    white = RandomPlayer(seed=1)
    black = RandomPlayer(seed=2)
    game = play_game(white, black, max_plies=500, show_board=False)
    assert game["result"] in ("1-0", "0-1", "1/2-1/2")
    assert game["termination"] != "illegal_move"
    assert all(not p["illegal"] for p in game["plies"])
    assert len(game["plies"]) > 0
    out = export_game_html(game, tmp_path / "game.html")
    assert out.exists()
    text = out.read_text(encoding="utf-8")
    assert "Move list" in text
    assert game["white"] == "random"


def test_legal_move_cap_and_choice_shape():
    import chess
    from chess_bench.players.base import (
        MAX_CHOICE_OPTIONS,
        build_questions,
        legal_uci_moves,
    )

    board = chess.Board()
    moves = legal_uci_moves(board)
    assert 1 <= len(moves) <= MAX_CHOICE_OPTIONS
    q = build_questions(board, moves)
    assert q["move"]["type"] == "choice"
    assert set(q["move"]["criteria"].keys()) == set(moves)
