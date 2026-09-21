"""Live chess bench API: stream Jev vs Laya plies over SSE; serve docs UI."""

from __future__ import annotations

import asyncio
import json
import os
import random
import threading
from pathlib import Path
from queue import Empty, Queue
from typing import Any, AsyncIterator, Literal

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles

from chess_bench.match import play_game
from chess_bench.players import make_player
from chess_bench.players.base import MoveDecision, Player
from chess_bench.players.jev import JevPlayer
from chess_bench.players.laya_player import LayaPlayer

DOCS_DIR = Path(__file__).resolve().parent.parent / "docs"
DEFAULT_MAX_PLIES = 80

from contextlib import asynccontextmanager


@asynccontextmanager
async def _lifespan(_app: FastAPI):
    def warm() -> None:
        try:
            print("Warming Laya checkpoint (first load can take minutes)…", flush=True)
            _get_player("laya")
            print("Laya ready.", flush=True)
        except Exception as exc:  # noqa: BLE001
            print(f"Laya warm failed: {type(exc).__name__}: {exc}", flush=True)

    threading.Thread(target=warm, daemon=True).start()
    yield


app = FastAPI(title="Jev vs Laya Chess Bench", version="0.2.0", lifespan=_lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

_lock = threading.Lock()
_players: dict[str, Player] = {}
_game_busy = threading.Lock()


def _key_configured() -> bool:
    return bool(os.environ.get("TYPESAFE_API_KEY", ""))


def _get_player(name: str) -> Player:
    key = name.lower()
    with _lock:
        if key not in _players:
            if key == "jev":
                _players[key] = JevPlayer()
            elif key == "laya":
                # Eager-load so first live ply is not a multi-minute cold start mid-stream.
                _players[key] = LayaPlayer(lazy=False)
            else:
                _players[key] = make_player(key)
        return _players[key]


def _sse(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, separators=(',', ':'))}\n\n"


def _run_game_to_queue(
    q: Queue,
    *,
    white_name: str,
    black_name: str,
    max_plies: int,
) -> None:
    try:
        white = _get_player(white_name)
        black = _get_player(black_name)
        q.put(
            (
                "start",
                {
                    "white": white.name,
                    "black": black.name,
                    "max_plies": max_plies,
                    "typesafe_api_key": "set" if _key_configured() else "missing",
                },
            )
        )

        def on_ply(ply_rec: dict[str, Any], board: Any, decision: MoveDecision) -> None:
            payload = {
                "ply": ply_rec.get("ply"),
                "player": ply_rec.get("player"),
                "color": ply_rec.get("color"),
                "uci": ply_rec.get("uci"),
                "san": ply_rec.get("san"),
                "fen": ply_rec.get("fen") or ply_rec.get("fen_after"),
                "latency_ms": ply_rec.get("latency_ms"),
                "confidence": ply_rec.get("confidence"),
                "probabilities": ply_rec.get("probabilities") or None,
                "illegal": ply_rec.get("illegal"),
                "error": ply_rec.get("error"),
            }
            q.put(("ply", payload))

        game = play_game(white, black, max_plies=max_plies, on_ply=on_ply)
        q.put(
            (
                "end",
                {
                    "result": game["result"],
                    "termination": game["termination"],
                    "final_fen": game["final_fen"],
                    "white": game["white"],
                    "black": game["black"],
                    "plies": len(game["plies"]),
                },
            )
        )
    except Exception as exc:  # noqa: BLE001 — surface to client
        q.put(("error", {"message": f"{type(exc).__name__}: {exc}"}))
    finally:
        q.put(None)


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "typesafe_api_key": "set" if _key_configured() else "missing",
        "docs_dir": str(DOCS_DIR),
        "docs_present": DOCS_DIR.is_dir(),
    }


@app.get("/api/game/stream")
async def game_stream(
    white: Literal["jev", "laya", "random"] | None = Query(
        default=None,
        description="Who plays White; omit to randomize jev|laya",
    ),
    max_plies: int = Query(default=DEFAULT_MAX_PLIES, ge=1, le=400),
) -> StreamingResponse:
    if not _key_configured():
        async def missing() -> AsyncIterator[str]:
            yield _sse("error", {"message": "TYPESAFE_API_KEY is not set on the server"})

        return StreamingResponse(
            missing(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    if white is None:
        white_name = random.choice(["jev", "laya"])
    else:
        white_name = white

    if white_name == "random":
        black_name = "jev"
    elif white_name in ("jev", "laya"):
        black_name = "laya" if white_name == "jev" else "jev"
    else:
        black_name = "laya"

    if not _game_busy.acquire(blocking=False):
        async def busy() -> AsyncIterator[str]:
            yield _sse(
                "error",
                {"message": "A live game is already running. Try again when it finishes."},
            )

        return StreamingResponse(
            busy(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    q: Queue = Queue()

    def worker() -> None:
        try:
            _run_game_to_queue(
                q, white_name=white_name, black_name=black_name, max_plies=max_plies
            )
        finally:
            _game_busy.release()

    threading.Thread(target=worker, daemon=True).start()

    async def event_gen() -> AsyncIterator[str]:
        yield _sse("hello", {"live": True})
        while True:
            try:
                item = await asyncio.to_thread(q.get, True, 0.5)
            except Empty:
                yield ": keepalive\n\n"
                continue
            if item is None:
                break
            event, data = item
            yield _sse(event, data)

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/api/games")
async def start_game_info(
    white: Literal["jev", "laya"] | None = None,
    max_plies: int = DEFAULT_MAX_PLIES,
) -> dict[str, Any]:
    """Describe how to open the SSE stream for a new live game."""
    w = white or random.choice(["jev", "laya"])
    b = "laya" if w == "jev" else "jev"
    return {
        "stream_url": f"/api/game/stream?white={w}&max_plies={max_plies}",
        "white": w,
        "black": b,
        "max_plies": max_plies,
        "typesafe_api_key": "set" if _key_configured() else "missing",
    }


if DOCS_DIR.is_dir():
    app.mount("/", StaticFiles(directory=str(DOCS_DIR), html=True), name="docs")


def main() -> None:
    import uvicorn

    if not _key_configured():
        raise SystemExit("TYPESAFE_API_KEY is not set — refuse to start live server.")
    host = os.environ.get("BENCH_HOST", "127.0.0.1")
    port = int(os.environ.get("BENCH_PORT", "8787"))
    uvicorn.run(
        "chess_bench.server:app",
        host=host,
        port=port,
        log_level="info",
        reload=False,
    )


if __name__ == "__main__":
    main()
