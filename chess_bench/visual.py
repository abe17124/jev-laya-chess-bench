"""Terminal board + HTML game export for screen recording."""

from __future__ import annotations

import html
from pathlib import Path
from typing import Any

import chess


def render_terminal_board(board: chess.Board, last_uci: str | None = None) -> str:
    header = f"move {board.fullmove_number}  side={'white' if board.turn else 'black'}"
    if last_uci:
        header += f"  last={last_uci}"
    return f"{header}\n{board}\n"


def export_game_html(
    game: dict[str, Any],
    path: str | Path,
    title: str | None = None,
) -> Path:
    path = Path(path)
    white = game.get("white", "white")
    black = game.get("black", "black")
    result = game.get("result", "*")
    title = title or f"{white} vs {black} — {result}"

    rows = []
    for ply in game.get("plies", []):
        conf = ply.get("confidence")
        conf_s = f"{conf:.3f}" if isinstance(conf, (int, float)) else "—"
        rows.append(
            "<tr>"
            f"<td>{ply.get('ply')}</td>"
            f"<td>{html.escape(str(ply.get('player', '')))}</td>"
            f"<td><code>{html.escape(str(ply.get('uci', '')))}</code></td>"
            f"<td>{html.escape(str(ply.get('san', '')))}</td>"
            f"<td>{float(ply.get('latency_ms', 0)):.1f}</td>"
            f"<td>{conf_s}</td>"
            f"<td>{'yes' if ply.get('illegal') else ''}</td>"
            "</tr>"
        )

    # Replay final FEN board as unicode grid if present.
    fen = game.get("final_fen") or chess.STARTING_FEN
    board = chess.Board(fen)
    board_pre = html.escape(str(board))

    doc = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>{html.escape(title)}</title>
<style>
  body {{ font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
         background: #0f1115; color: #e6e6e6; margin: 2rem; }}
  h1 {{ font-size: 1.25rem; }}
  .meta {{ color: #9aa0a6; margin-bottom: 1rem; }}
  table {{ border-collapse: collapse; width: 100%; max-width: 900px; }}
  th, td {{ border-bottom: 1px solid #2a2f3a; padding: 0.4rem 0.6rem; text-align: left; }}
  th {{ color: #9aa0a6; font-weight: 600; }}
  pre.board {{ background: #1a1f2b; padding: 1rem; display: inline-block;
               line-height: 1.35; letter-spacing: 0.05em; }}
  code {{ color: #7dd3fc; }}
</style>
</head>
<body>
  <h1>{html.escape(title)}</h1>
  <div class="meta">
    White: {html.escape(white)} &nbsp;|&nbsp;
    Black: {html.escape(black)} &nbsp;|&nbsp;
    Result: {html.escape(str(result))} &nbsp;|&nbsp;
    Plies: {len(game.get('plies', []))}
  </div>
  <h2>Final position</h2>
  <pre class="board">{board_pre}</pre>
  <h2>Move list</h2>
  <table>
    <thead>
      <tr><th>#</th><th>Player</th><th>UCI</th><th>SAN</th><th>ms</th><th>conf</th><th>illegal</th></tr>
    </thead>
    <tbody>
      {''.join(rows)}
    </tbody>
  </table>
</body>
</html>
"""
    path.write_text(doc, encoding="utf-8")
    return path
