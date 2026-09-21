"""Random legal-move player for offline demos and tests."""

from __future__ import annotations

import random
import time

import chess

from chess_bench.players.base import MoveDecision, Player, legal_uci_moves


class RandomPlayer(Player):
    name = "random"

    def __init__(self, seed: int | None = None) -> None:
        self._rng = random.Random(seed)

    def choose(self, board: chess.Board) -> MoveDecision:
        moves = legal_uci_moves(board)
        if not moves:
            return MoveDecision(
                move_uci="",
                latency_ms=0.0,
                illegal=True,
                error="no legal moves",
            )
        t0 = time.perf_counter()
        pick = self._rng.choice(moves)
        ms = (time.perf_counter() - t0) * 1000.0
        n = len(moves)
        probs = {m: (1.0 / n) for m in moves}
        return MoveDecision(
            move_uci=pick,
            latency_ms=ms,
            probabilities=probs,
            confidence=1.0 / n,
            raw={"source": "random"},
        )
