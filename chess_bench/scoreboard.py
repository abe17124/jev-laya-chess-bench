"""Tony-style W/D/L scoreboard with latency stats."""

from __future__ import annotations

import statistics
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any


def _percentile(sorted_vals: list[float], p: float) -> float:
    if not sorted_vals:
        return 0.0
    if len(sorted_vals) == 1:
        return sorted_vals[0]
    k = (len(sorted_vals) - 1) * (p / 100.0)
    f = int(k)
    c = min(f + 1, len(sorted_vals) - 1)
    if f == c:
        return sorted_vals[f]
    return sorted_vals[f] + (sorted_vals[c] - sorted_vals[f]) * (k - f)


@dataclass
class PlayerStats:
    name: str
    wins: int = 0
    draws: int = 0
    losses: int = 0
    latencies_ms: list[float] = field(default_factory=list)
    illegal_count: int = 0
    move_count: int = 0

    def record_latency(self, ms: float) -> None:
        self.latencies_ms.append(ms)
        self.move_count += 1

    def summary(self) -> dict[str, Any]:
        lat = sorted(self.latencies_ms)
        avg = statistics.fmean(lat) if lat else 0.0
        p50 = _percentile(lat, 50)
        return {
            "name": self.name,
            "W": self.wins,
            "D": self.draws,
            "L": self.losses,
            "moves": self.move_count,
            "avg_ms": round(avg, 2),
            "p50_ms": round(p50, 2),
            "illegal": self.illegal_count,
        }


def format_scoreboard(stats: dict[str, PlayerStats], title: str = "SCOREBOARD") -> str:
    lines = [
        "",
        f"═══ {title} ═══",
        f"{'Player':<12} {'W':>3} {'D':>3} {'L':>3}  {'avg ms':>8} {'p50 ms':>8}  {'illegal':>7}",
        "-" * 56,
    ]
    for name, st in stats.items():
        s = st.summary()
        lines.append(
            f"{s['name']:<12} {s['W']:>3} {s['D']:>3} {s['L']:>3}  "
            f"{s['avg_ms']:>8.1f} {s['p50_ms']:>8.1f}  {s['illegal']:>7}"
        )
    lines.append("")
    return "\n".join(lines)


def empty_stats(names: list[str]) -> dict[str, PlayerStats]:
    # Preserve insertion order for head-to-head display.
    out: dict[str, PlayerStats] = {}
    for n in names:
        if n not in out:
            out[n] = PlayerStats(name=n)
    return out


def aggregate_from_games(games: list[dict[str, Any]]) -> dict[str, PlayerStats]:
    names: list[str] = []
    for g in games:
        for k in ("white", "black"):
            n = g.get(k)
            if n and n not in names:
                names.append(n)
    stats = empty_stats(names)
    for g in games:
        white = g["white"]
        black = g["black"]
        result = g.get("result")  # "1-0", "0-1", "1/2-1/2"
        if result == "1-0":
            stats[white].wins += 1
            stats[black].losses += 1
        elif result == "0-1":
            stats[black].wins += 1
            stats[white].losses += 1
        else:
            stats[white].draws += 1
            stats[black].draws += 1
        for ply in g.get("plies", []):
            player = ply.get("player")
            if player not in stats:
                stats[player] = PlayerStats(name=player)
            stats[player].record_latency(float(ply.get("latency_ms", 0.0)))
            if ply.get("illegal"):
                stats[player].illegal_count += 1
    return stats
