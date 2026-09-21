"""Laya (open System One) player — optional heavy weights."""

from __future__ import annotations

import os
import time
from typing import Any

import chess

from chess_bench.players.base import (
    MoveDecision,
    Player,
    build_questions,
    build_state,
    legal_uci_moves,
    normalize_answer,
)


class LayaUnavailableError(RuntimeError):
    """Raised when the laya package or checkpoint cannot be loaded."""


class LayaPlayer(Player):
    name = "laya"

    def __init__(
        self,
        repo: str = "convaiinnovations/laya",
        device: str | None = None,
        lazy: bool = True,
    ) -> None:
        self.repo = repo
        self.device = device
        self._agent: Any = None
        self._load_error: str | None = None
        if not lazy:
            self._ensure_loaded()

    def _ensure_loaded(self) -> None:
        if self._agent is not None:
            return
        if self._load_error is not None:
            raise LayaUnavailableError(self._load_error)
        # Avoid TensorFlow probe deadlocks during transformers import.
        os.environ.setdefault("USE_TF", "0")
        try:
            import laya  # type: ignore
        except Exception as exc:
            self._load_error = (
                f"laya package not available ({type(exc).__name__}: {exc}). "
                "Install with: pip install 'laya>=0.3.0' (pulls torch + transformers; "
                "~808 MB English checkpoint on first load)."
            )
            raise LayaUnavailableError(self._load_error) from exc

        try:
            kwargs: dict[str, Any] = {}
            if self.device:
                kwargs["device"] = self.device
            # English checkpoint at repo root (~808 MB).
            self._agent = laya.load(self.repo, **kwargs)
        except TypeError:
            # Older signatures may not accept device kwarg.
            try:
                self._agent = laya.load(self.repo)
            except Exception as exc:
                self._load_error = f"failed to load Laya checkpoint: {type(exc).__name__}: {exc}"
                raise LayaUnavailableError(self._load_error) from exc
        except Exception as exc:
            self._load_error = f"failed to load Laya checkpoint: {type(exc).__name__}: {exc}"
            raise LayaUnavailableError(self._load_error) from exc

    def choose(self, board: chess.Board) -> MoveDecision:
        moves = legal_uci_moves(board)
        if not moves:
            return MoveDecision(
                move_uci="",
                latency_ms=0.0,
                illegal=True,
                error="no legal moves",
            )
        try:
            self._ensure_loaded()
        except LayaUnavailableError as exc:
            return MoveDecision(
                move_uci=moves[0],
                latency_ms=0.0,
                illegal=True,
                error=str(exc),
            )

        state = build_state(board)
        questions = build_questions(board, moves)
        t0 = time.perf_counter()
        try:
            result = self._agent.predict(state, questions)
            latency_ms = (time.perf_counter() - t0) * 1000.0
        except Exception as exc:
            latency_ms = (time.perf_counter() - t0) * 1000.0
            return MoveDecision(
                move_uci=moves[0],
                latency_ms=latency_ms,
                illegal=True,
                error=f"laya predict failed: {type(exc).__name__}",
            )

        answers = (result or {}).get("answers") or {}
        answer = answers.get("move") if isinstance(answers, dict) else None
        choice, probs, confidence = normalize_answer(answer, moves)
        if not choice:
            return MoveDecision(
                move_uci=moves[0],
                latency_ms=latency_ms,
                probabilities=probs,
                confidence=confidence,
                illegal=True,
                error="laya returned no usable choice",
                raw={"answer": answer},
            )
        illegal = choice not in moves
        return MoveDecision(
            move_uci=choice if not illegal else moves[0],
            latency_ms=latency_ms,
            probabilities=probs,
            confidence=confidence,
            illegal=illegal,
            error="laya choice not in legal set" if illegal else None,
            raw={"answer": answer},
        )
