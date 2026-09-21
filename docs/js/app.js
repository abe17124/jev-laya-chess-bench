/* JEV vs LAYA — live chess (SSE). Play = new game. */
(function () {
  "use strict";

  const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  const MATCH_PATH = "data/jev_vs_laya.json";

  let board = null;
  let chess = null;
  let live = false;
  let es = null;
  let whiteName = null;
  let blackName = null;
  let plyCount = 0;
  let lastLat = { jev: null, laya: null };

  const $ = (sel) => document.querySelector(sel);

  function apiBase() {
    const b = (window.BENCH_API || "").replace(/\/$/, "");
    return b;
  }

  function streamUrl(params) {
    const q = new URLSearchParams(params || {});
    const path = "/api/game/stream" + (q.toString() ? "?" + q.toString() : "");
    const base = apiBase();
    return base ? base + path : path;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function fmtMs(v) {
    if (v == null || Number.isNaN(+v)) return "—";
    const n = +v;
    if (n < 10) return n.toFixed(2) + " ms";
    if (n < 1000) return Math.round(n) + " ms";
    return (n / 1000).toFixed(2) + " s";
  }
  function fmtPct(p) {
    return (p * 100).toFixed(1) + "%";
  }
  function isJev(n) {
    return String(n || "").toLowerCase().startsWith("jev");
  }
  function isLaya(n) {
    return String(n || "").toLowerCase().startsWith("laya");
  }
  function colorGlyph(side) {
    return side === "white" ? "♔" : "♚";
  }
  function colorLabel(side) {
    return side === "white" ? "White" : "Black";
  }

  function setPlaying(on) {
    live = on;
    const btn = $("#btnPlay");
    btn.disabled = on;
    btn.textContent = on ? "… LIVE" : "▶ PLAY";
    btn.classList.toggle("playing", on);
    btn.title = on ? "Game in progress" : "New live game";
  }

  function setColors(white, black) {
    whiteName = white;
    blackName = black;
    const setCard = (key, side) => {
      const colorEl = $(key === "jev" ? "#jevColor" : "#layaColor");
      const card = $(key === "jev" ? "#cardJev" : "#cardLaya");
      colorEl.textContent = `${colorGlyph(side)} ${colorLabel(side)}`;
      card.setAttribute("data-side", side);
    };
    if (isJev(white)) setCard("jev", "white");
    else if (isJev(black)) setCard("jev", "black");
    if (isLaya(white)) setCard("laya", "white");
    else if (isLaya(black)) setCard("laya", "black");
  }

  function updateLatCards() {
    $("#jevAvg").textContent =
      lastLat.jev == null ? "lat —" : `lat ${fmtMs(lastLat.jev)}`;
    $("#layaAvg").textContent =
      lastLat.laya == null ? "lat —" : `lat ${fmtMs(lastLat.laya)}`;
  }

  function resetBoard() {
    plyCount = 0;
    lastLat = { jev: null, laya: null };
    updateLatCards();
    if (chess) chess.reset();
    if (board) board.position("start", false);
    $("#plyLabel").textContent = "ply 0";
    $("#hMove").textContent = "—";
    $("#hPlayer").textContent = "—";
    $("#hLat").textContent = "—";
    $("#hUci").textContent = "—";
    $("#hConf").textContent = "—";
    $("#probs").innerHTML = "";
    $("#resultBadge").hidden = true;
    $("#turnBanner").textContent = "starting…";
    $("#scoreLine").textContent = "live game starting…";
  }

  function applyPly(ply) {
    plyCount = ply.ply || plyCount + 1;
    const fen = ply.fen || START_FEN;
    if (chess && fen) chess.load(fen);
    if (board && fen) board.position(fen, true);
    $("#plyLabel").textContent = `ply ${plyCount}`;
    $("#hMove").textContent = ply.san || ply.uci || "—";
    $("#hPlayer").textContent = (ply.player || "—").toUpperCase();
    $("#hPlayer").style.color = isJev(ply.player)
      ? "var(--jev)"
      : isLaya(ply.player)
        ? "var(--laya)"
        : "inherit";
    $("#hLat").textContent = fmtMs(ply.latency_ms);
    $("#hUci").textContent = ply.uci || "—";
    $("#hConf").textContent =
      ply.confidence == null ? "—" : (+ply.confidence).toFixed(4);
    renderProbs(ply);

    if (isJev(ply.player)) lastLat.jev = ply.latency_ms;
    if (isLaya(ply.player)) lastLat.laya = ply.latency_ms;
    updateLatCards();

    const nextSide = fen.includes(" w ") ? "white" : "black";
    const nextPlayer =
      nextSide === "white" ? whiteName : blackName;
    $("#turnBanner").textContent = `${(nextPlayer || "?").toUpperCase()} to move  ${colorGlyph(nextSide)} ${colorLabel(nextSide)}`;
    $("#scoreLine").textContent = `LIVE · ${fmtMs(ply.latency_ms)} · ${(ply.player || "").toUpperCase()} ${ply.san || ply.uci || ""}`;
  }

  function renderProbs(ply) {
    const box = $("#probs");
    const probs = ply.probabilities || {};
    const entries = Object.entries(probs)
      .map(([uci, p]) => ({ uci, p: +p }))
      .filter((e) => !Number.isNaN(e.p))
      .sort((a, b) => b.p - a.p)
      .slice(0, 6);
    if (!entries.length) {
      box.innerHTML = "";
      return;
    }
    const maxP = entries[0].p || 1;
    box.innerHTML = entries
      .map((e) => {
        const chosen = e.uci === ply.uci ? " chosen" : "";
        const w = Math.max(2, (e.p / maxP) * 100);
        return `<div class="prob${chosen}">
          <span class="uci">${escapeHtml(e.uci)}</span>
          <span class="bar"><i style="width:${w}%"></i></span>
          <span class="pct">${fmtPct(e.p)}</span>
        </div>`;
      })
      .join("");
  }

  function closeStream() {
    if (es) {
      try {
        es.close();
      } catch (_) {}
      es = null;
    }
  }

  function startLiveGame() {
    if (live) return;
    closeStream();
    resetBoard();
    setPlaying(true);

    const url = streamUrl({ max_plies: "80" });
    $("#footerNote").textContent = "live · " + url;
    es = new EventSource(url);

    es.addEventListener("hello", () => {
      $("#scoreLine").textContent = "connected · waiting for first ply…";
    });

    es.addEventListener("start", (ev) => {
      let data = {};
      try {
        data = JSON.parse(ev.data);
      } catch (_) {}
      setColors(data.white, data.black);
      $("#scoreLine").textContent = `LIVE · ${(data.white || "?").toUpperCase()} (W) vs ${(data.black || "?").toUpperCase()} (B)`;
      $("#turnBanner").textContent = `${(data.white || "?").toUpperCase()} to move  ♔ White`;
      $("#jevWdl").textContent = "live";
      $("#layaWdl").textContent = "live";
    });

    es.addEventListener("ply", (ev) => {
      let ply = {};
      try {
        ply = JSON.parse(ev.data);
      } catch (_) {
        return;
      }
      applyPly(ply);
    });

    es.addEventListener("end", (ev) => {
      let data = {};
      try {
        data = JSON.parse(ev.data);
      } catch (_) {}
      const badge = $("#resultBadge");
      badge.hidden = false;
      badge.textContent = `RESULT ${data.result || "*"}${data.termination ? " · " + data.termination : ""}`;
      $("#turnBanner").textContent = "game over";
      $("#scoreLine").textContent = `done · ${data.result || "*"} · ${data.plies || plyCount} plies`;
      setPlaying(false);
      closeStream();
    });

    es.addEventListener("error", (ev) => {
      // EventSource also fires generic "error" on network drop; only parse if data present.
      if (ev && ev.data) {
        let data = {};
        try {
          data = JSON.parse(ev.data);
        } catch (_) {}
        $("#scoreLine").textContent = "error · " + (data.message || "stream error");
        $("#turnBanner").textContent = "error";
        setPlaying(false);
        closeStream();
      } else if (es && es.readyState === EventSource.CLOSED) {
        if (live) {
          $("#scoreLine").textContent = "stream closed";
          setPlaying(false);
        }
      }
    });

    es.onerror = () => {
      if (es && es.readyState === EventSource.CLOSED && live) {
        $("#scoreLine").textContent =
          "could not reach API — is the live server / tunnel up?";
        $("#turnBanner").textContent = "offline";
        setPlaying(false);
        closeStream();
      }
    };
  }

  /* Optional recorded replay (collapsed). */
  async function loadReplayOptional() {
    const box = $("#replayBox");
    try {
      const res = await fetch(MATCH_PATH);
      if (!res.ok) throw new Error("no replay");
      const data = await res.json();
      const games = data.games_detail || [];
      const list = $("#matchList");
      list.innerHTML = "";
      games.forEach((g, i) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "match-btn";
        btn.innerHTML = `<span class="t">Game ${i + 1}</span><span class="s">${escapeHtml(g.result || "*")} · ${(g.plies || []).length} plies</span>`;
        btn.addEventListener("click", () => {
          if (live) return;
          const last = (g.plies || [])[(g.plies || []).length - 1];
          setColors(g.white, g.black);
          if (last && last.fen_after && board) board.position(last.fen_after, false);
          $("#scoreLine").textContent = `replay · Game ${i + 1} · ${g.result || "*"}`;
          $("#matchMeta").textContent = "static JSON (not live)";
          const badge = $("#resultBadge");
          badge.hidden = false;
          badge.textContent = `RESULT ${g.result || "*"}`;
        });
        list.appendChild(btn);
      });
      $("#matchMeta").textContent = `${games.length} recorded · optional`;
    } catch (_) {
      if (box) box.hidden = true;
    }
  }

  function initBoard() {
    chess = new Chess();
    board = Chessboard("board", {
      position: "start",
      draggable: false,
      pieceTheme: "https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png",
      appearSpeed: 120,
      moveSpeed: 160,
    });
    window.addEventListener("resize", () => board && board.resize());
  }

  function boot() {
    initBoard();
    $("#btnPlay").addEventListener("click", startLiveGame);
    document.addEventListener("keydown", (e) => {
      if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        startLiveGame();
      }
    });
    loadReplayOptional();
    // Probe health if same-origin or BENCH_API set
    const base = apiBase();
    const healthUrl = (base || "") + "/health";
    fetch(healthUrl)
      .then((r) => (r.ok ? r.json() : null))
      .then((h) => {
        if (!h) return;
        $("#footerNote").textContent =
          `api ok · key ${h.typesafe_api_key} · press PLAY`;
      })
      .catch(() => {
        $("#footerNote").textContent =
          "no live API on this origin — set window.BENCH_API or open the tunnel URL";
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
