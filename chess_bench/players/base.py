"""Shared player types and Choice helpers."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Mapping

import chess

# System One Choice criteria hard limit.
MAX_CHOICE_OPTIONS = 255

CHOICE_INSTRUCTIONS = (
    "You are playing chess. Choose the single best legal move for the side to move. "
    "Keys are UCI move strings. Prefer sound development, tactics, king safety, "
    "and material. Avoid blunders."
)


@dataclass
class MoveDecision:
    """One ply decision from a System One-style Choice call."""

    move_uci: str
    latency_ms: float
    probabilities: dict[str, float] = field(default_factory=dict)
    confidence: float | None = None
    raw: dict[str, Any] = field(default_factory=dict)
    illegal: bool = False
    error: str | None = None


class Player(ABC):
    name: str

    @abstractmethod
    def choose(self, board: chess.Board) -> MoveDecision:
        """Return a legal UCI move for the current position."""

    def close(self) -> None:
        """Optional cleanup."""


def legal_uci_moves(board: chess.Board) -> list[str]:
    moves = [m.uci() for m in board.legal_moves]
    moves.sort()
    if len(moves) > MAX_CHOICE_OPTIONS:
        # Chess never exceeds ~218 legal moves; still enforce the API cap.
        moves = moves[:MAX_CHOICE_OPTIONS]
    return moves


def build_choice_criteria(moves: list[str], board: chess.Board) -> dict[str, str | None]:
    """Map UCI keys to short SAN descriptions for Choice criteria."""
    criteria: dict[str, str | None] = {}
    for uci in moves:
        move = chess.Move.from_uci(uci)
        try:
            san = board.san(move)
        except ValueError:
            san = uci
        criteria[uci] = f"Play {san}"
    return criteria


def build_state(board: chess.Board) -> dict[str, Any]:
    side = "white" if board.turn == chess.WHITE else "black"
    return {
        "fen": board.fen(),
        "side_to_move": side,
        "fullmove_number": board.fullmove_number,
        "ply": board.ply(),
        "task": "Choose the best legal chess move in UCI.",
    }


def build_questions(board: chess.Board, moves: list[str]) -> dict[str, Any]:
    return {
        "move": {
            "type": "choice",
            "instructions": CHOICE_INSTRUCTIONS,
            "criteria": build_choice_criteria(moves, board),
        }
    }


def normalize_answer(
    answer: Mapping[str, Any] | None,
    legal: list[str],
) -> tuple[str | None, dict[str, float], float | None]:
    """Extract choice / probabilities / confidence from a System One answer."""
    if not answer:
        return None, {}, None
    choice = answer.get("choice")
    probs_raw = answer.get("probabilities") or {}
    probs: dict[str, float] = {}
    if isinstance(probs_raw, Mapping):
        for k, v in probs_raw.items():
            try:
                probs[str(k)] = float(v)
            except (TypeError, ValueError):
                continue
    conf = answer.get("confidence")
    try:
        confidence = float(conf) if conf is not None else None
    except (TypeError, ValueError):
        confidence = None
    if choice is not None:
        choice = str(choice)
        if choice not in legal:
            # Fallback: highest-prob legal key, else first legal.
            if probs:
                ranked = sorted(
                    ((k, p) for k, p in probs.items() if k in legal),
                    key=lambda kp: kp[1],
                    reverse=True,
                )
                if ranked:
                    choice = ranked[0][0]
                else:
                    choice = legal[0] if legal else None
            else:
                choice = legal[0] if legal else None
    return choice, probs, confidence
