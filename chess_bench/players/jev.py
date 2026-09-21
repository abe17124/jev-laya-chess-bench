"""TypeSafe Jev player via System One Choice API."""

from __future__ import annotations

import os
import time
from typing import Any

import chess
import httpx

from chess_bench.players.base import (
    MoveDecision,
    Player,
    build_questions,
    build_state,
    legal_uci_moves,
    normalize_answer,
)

DEFAULT_ENDPOINT = "https://api.typesafe.ai/v1/systemone"


class JevPlayer(Player):
    name = "jev"

    def __init__(
        self,
        api_key: str | None = None,
        model: str = "jev-latest",
        endpoint: str = DEFAULT_ENDPOINT,
        timeout_s: float = 60.0,
    ) -> None:
        # Never log or print the key.
        self._api_key = api_key if api_key is not None else os.environ.get("TYPESAFE_API_KEY", "")
        self.model = model
        self.endpoint = endpoint
        self.timeout_s = timeout_s
        self._client = httpx.Client(timeout=timeout_s)

    @property
    def api_key_configured(self) -> bool:
        return bool(self._api_key) and len(self._api_key) > 0

    def choose(self, board: chess.Board) -> MoveDecision:
        moves = legal_uci_moves(board)
        if not moves:
            return MoveDecision(
                move_uci="",
                latency_ms=0.0,
                illegal=True,
                error="no legal moves",
            )
        if not self.api_key_configured:
            return MoveDecision(
                move_uci=moves[0],
                latency_ms=0.0,
                illegal=True,
                error="TYPESAFE_API_KEY is not set",
            )

        payload: dict[str, Any] = {
            "model": self.model,
            "state": build_state(board),
            "questions": build_questions(board, moves),
        }
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }

        t0 = time.perf_counter()
        try:
            resp = self._client.post(self.endpoint, json=payload, headers=headers)
            latency_ms = (time.perf_counter() - t0) * 1000.0
            resp.raise_for_status()
            data = resp.json()
        except Exception as exc:  # network / HTTP
            latency_ms = (time.perf_counter() - t0) * 1000.0
            return MoveDecision(
                move_uci=moves[0],
                latency_ms=latency_ms,
                illegal=True,
                error=f"jev request failed: {type(exc).__name__}",
                raw={},
            )

        answers = data.get("answers") or {}
        answer = answers.get("move") if isinstance(answers, dict) else None
        choice, probs, confidence = normalize_answer(answer, moves)
        if not choice:
            return MoveDecision(
                move_uci=moves[0],
                latency_ms=latency_ms,
                probabilities=probs,
                confidence=confidence,
                illegal=True,
                error="jev returned no usable choice",
                raw={"model": data.get("model"), "usage": data.get("usage")},
            )

        illegal = choice not in moves
        return MoveDecision(
            move_uci=choice if not illegal else moves[0],
            latency_ms=latency_ms,
            probabilities=probs,
            confidence=confidence,
            illegal=illegal,
            error="jev choice not in legal set" if illegal else None,
            raw={
                "model": data.get("model"),
                "usage": data.get("usage"),
                "answer": answer,
            },
        )

    def close(self) -> None:
        self._client.close()
