from chess_bench.players.base import MoveDecision, Player
from chess_bench.players.jev import JevPlayer
from chess_bench.players.laya_player import LayaPlayer, LayaUnavailableError
from chess_bench.players.random_player import RandomPlayer

PLAYER_NAMES = ("jev", "laya", "random")


def make_player(name: str, **kwargs) -> Player:
    key = name.strip().lower()
    if key == "random":
        return RandomPlayer(seed=kwargs.get("seed"))
    if key == "jev":
        return JevPlayer(
            api_key=kwargs.get("api_key"),
            model=kwargs.get("model", "jev-latest"),
            timeout_s=kwargs.get("timeout_s", 60.0),
        )
    if key == "laya":
        return LayaPlayer(
            repo=kwargs.get("laya_repo", "convaiinnovations/laya"),
            device=kwargs.get("laya_device"),
        )
    raise ValueError(f"Unknown player: {name!r}. Choose from {PLAYER_NAMES}")


__all__ = [
    "MoveDecision",
    "Player",
    "JevPlayer",
    "LayaPlayer",
    "LayaUnavailableError",
    "RandomPlayer",
    "PLAYER_NAMES",
    "make_player",
]
