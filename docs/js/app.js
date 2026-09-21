/* JEV vs LAYA — live chess (SSE). Play = new game. Replay = last completed. */
(function () {
  "use strict";

  const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  const MATCH_PATH = "data/jev_vs_laya.json";
  const PACE_MIN_MS = 200;
  const PACE_MAX_MS = 2000;
  const PACE_DEFAULT_MS = 850;

  let board = null;
  let chess = null;
  let live = false;
  let replaying = false;
  let es = null;
  let whiteName = null;
  let blackName = null;
  let plyCount = 0;
  let lastLat = { jev: null, laya: null };

  // Playback queue: ply/end events arrive as soon as decided; reveal at human pace.
  let revealQueue = [];
  let revealTimer = null;
  let revealBusy = false;
  let paceMs = PACE_DEFAULT_MS;
  let pendingEnd = null;
  let streamDone = false;

  // Client-side store of last completed live game (for Replay).
  let storedGame = null; // { white, black, plies: [], end: {} }
  let collectingPlies = [];
  let viewMode = "idle"; // idle | live | replay

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
  function shortName(n) {
    const s = String(n || "").toUpperCase();
    if (s.startsWith("JEV")) return "JEV";
    if (s.startsWith("LAYA")) return "LAYA";
    return s || "?";
  }

  function updateControlButtons() {
    const play = $("#btnPlay");
    const replay = $("#btnReplay");
    const busy = live || replaying;

    play.disabled = busy;
    play.textContent = live ? "… LIVE" : "▶ PLAY";
    play.classList.toggle("playing", live);
    play.title = live ? "Game in progress" : "New live game";

    const canReplay = !!(storedGame && storedGame.plies && storedGame.plies.length);
    replay.disabled = busy || !canReplay;
    replay.textContent = replaying ? "… REPLAY" : "↺ REPLAY";
    replay.classList.toggle("playing", replaying);
    replay.title = !canReplay
      ? "Finish a live game first"
      : replaying
        ? "Replaying…"
        : "Replay last completed game";
  }

  function setPlaying(on) {
    live = on;
    if (on) {
      replaying = false;
      viewMode = "live";
    } else if (!replaying) {
      viewMode = "idle";
    }
    updateControlButtons();
  }

  function setReplaying(on) {
    replaying = on;
    if (on) {
      live = false;
      viewMode = "replay";
    } else if (!live) {
      viewMode = "idle";
    }
    updateControlButtons();
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

  function hideWinner() {
    const box = $("#winnerBox");
    if (box) {
      box.hidden = true;
      box.textContent = "";
      box.removeAttribute("data-kind");
    }
  }

  /** Map PGN-ish result + side names → big WINNER / DRAW label. */
  function winnerFromResult(result, white, black) {
    const r = String(result || "*").trim();
    const w = shortName(white);
    const b = shortName(black);
    if (r === "1-0" || r === "1–0") {
      return { kind: "win", text: `WINNER: ${w}` };
    }
    if (r === "0-1" || r === "0–1") {
      return { kind: "win", text: `WINNER: ${b}` };
    }
    if (
      r === "1/2-1/2" ||
      r === "½-½" ||
      r === "1/2–1/2" ||
      /^draw/i.test(r)
    ) {
      return { kind: "draw", text: "DRAW" };
    }
    return { kind: "other", text: `RESULT: ${r}` };
  }

  function showWinner(data) {
    const box = $("#winnerBox");
    if (!box) return;
    const white = (data && data.white) || whiteName;
    const black = (data && data.black) || blackName;
    const info = winnerFromResult(data && data.result, white, black);
    const term = data && data.termination ? ` · ${data.termination}` : "";
    box.hidden = false;
    box.setAttribute("data-kind", info.kind);
    box.innerHTML =
      `<span class="winner-main">${escapeHtml(info.text)}</span>` +
      (term
        ? `<span class="winner-sub">${escapeHtml(term.trim())}</span>`
        : "");
  }

  function clearRevealQueue() {
    revealQueue = [];
    pendingEnd = null;
    streamDone = false;
    revealBusy = false;
    if (revealTimer) {
      clearTimeout(revealTimer);
      revealTimer = null;
    }
  }

  function resetBoard() {
    clearRevealQueue();
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
    hideWinner();
    $("#turnBanner").textContent = "thinking… connecting";
    $("#scoreLine").textContent = "live game starting…";
  }

  function showThinking(data) {
    const player = (data && data.player) || "?";
    const color = (data && data.color) || "";
    const msg =
      (data && data.message) ||
      `${String(player).toUpperCase()} thinking…`;
    const sideBit = color
      ? `  ${colorGlyph(color)} ${colorLabel(color)}`
      : "";
    $("#turnBanner").textContent = `${msg}${sideBit}`;
    if (!plyCount) {
      $("#scoreLine").textContent = `waiting · ${String(player).toUpperCase()} thinking…`;
    }
  }

  function showStatus(data) {
    const msg = (data && data.message) || "working…";
    $("#turnBanner").textContent = msg;
    $("#scoreLine").textContent = msg;
    if (data && data.white && data.black) {
      setColors(data.white, data.black);
    }
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
    const tag = viewMode === "replay" ? "REPLAY" : "LIVE";
    $("#scoreLine").textContent = `${tag} · ${fmtMs(ply.latency_ms)} · ${(ply.player || "").toUpperCase()} ${ply.san || ply.uci || ""}`;
  }

  function applyEnd(data) {
    const badge = $("#resultBadge");
    badge.hidden = false;
    badge.textContent = `RESULT ${data.result || "*"}${data.termination ? " · " + data.termination : ""}`;
    $("#turnBanner").textContent = "game over";
    const tag = viewMode === "replay" ? "replay done" : "done";
    $("#scoreLine").textContent = `${tag} · ${data.result || "*"} · ${data.plies || plyCount} plies`;
    showWinner({
      result: data.result,
      termination: data.termination,
      white: data.white || whiteName,
      black: data.black || blackName,
    });
    if (live) setPlaying(false);
    if (replaying) setReplaying(false);
    updateControlButtons();
  }

  function scheduleReveal() {
    if (revealBusy || revealTimer) return;
    if (!revealQueue.length) {
      if (streamDone && pendingEnd) {
        const end = pendingEnd;
        pendingEnd = null;
        applyEnd(end);
      }
      return;
    }
    revealBusy = true;
    const item = revealQueue.shift();
    if (item.type === "ply") {
      applyPly(item.data);
    } else if (item.type === "end") {
      applyEnd(item.data);
      revealBusy = false;
      return;
    }
    revealTimer = setTimeout(() => {
      revealTimer = null;
      revealBusy = false;
      scheduleReveal();
    }, paceMs);
  }

  function enqueuePly(ply) {
    revealQueue.push({ type: "ply", data: ply });
    scheduleReveal();
  }

  function enqueueEnd(data) {
    streamDone = true;
    // Reveal result only after queued plies have been shown.
    if (revealQueue.length || revealBusy || revealTimer) {
      pendingEnd = data;
      scheduleReveal();
    } else {
      applyEnd(data);
    }
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

  function clampPace(ms) {
    const n = Math.round(+ms);
    if (Number.isNaN(n)) return PACE_DEFAULT_MS;
    return Math.min(PACE_MAX_MS, Math.max(PACE_MIN_MS, n));
  }

  function updateSpeedLabel() {
    const label = $("#speedLabel");
    if (label) label.textContent = paceMs + " ms/move";
  }

  /** Continuous delay between plies (replay + live reveal share paceMs). */
  function setPaceMs(ms) {
    paceMs = clampPace(ms);
    const slider = $("#speedSlider");
    if (slider && +slider.value !== paceMs) slider.value = String(paceMs);
    updateSpeedLabel();
  }

  function storeCompletedGame(endData) {
    storedGame = {
      white: whiteName,
      black: blackName,
      plies: collectingPlies.slice(),
      end: Object.assign({}, endData, {
        white: whiteName,
        black: blackName,
      }),
    };
    updateControlButtons();
  }

  function startLiveGame() {
    if (live || replaying) return;
    closeStream();
    collectingPlies = [];
    resetBoard();
    setPlaying(true);

    const url = streamUrl({ max_plies: "80" });
    $("#footerNote").textContent = "live · " + url;
    es = new EventSource(url);

    es.addEventListener("hello", (ev) => {
      let data = {};
      try {
        data = JSON.parse(ev.data);
      } catch (_) {}
      if (data.white && data.black) setColors(data.white, data.black);
      $("#scoreLine").textContent = "connected · thinking… waiting for first move";
      $("#turnBanner").textContent = "thinking… loading / first call can be slow";
    });

    es.addEventListener("status", (ev) => {
      let data = {};
      try {
        data = JSON.parse(ev.data);
      } catch (_) {}
      showStatus(data);
    });

    es.addEventListener("thinking", (ev) => {
      let data = {};
      try {
        data = JSON.parse(ev.data);
      } catch (_) {}
      // Status updates apply immediately (not paced) so waits feel labeled.
      showThinking(data);
    });

    es.addEventListener("start", (ev) => {
      let data = {};
      try {
        data = JSON.parse(ev.data);
      } catch (_) {}
      setColors(data.white, data.black);
      $("#scoreLine").textContent = `LIVE · ${(data.white || "?").toUpperCase()} (W) vs ${(data.black || "?").toUpperCase()} (B)`;
      $("#turnBanner").textContent = `${(data.white || "?").toUpperCase()} thinking…  ♔ White`;
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
      collectingPlies.push(ply);
      enqueuePly(ply);
    });

    es.addEventListener("end", (ev) => {
      let data = {};
      try {
        data = JSON.parse(ev.data);
      } catch (_) {}
      storeCompletedGame(data);
      enqueueEnd(data);
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
        clearRevealQueue();
        closeStream();
      } else if (es && es.readyState === EventSource.CLOSED) {
        if (live && !streamDone && !pendingEnd && !revealQueue.length) {
          $("#scoreLine").textContent = "stream closed";
          setPlaying(false);
        }
      }
    });

    es.onerror = () => {
      if (es && es.readyState === EventSource.CLOSED && live) {
        if (!streamDone && !pendingEnd && !revealQueue.length) {
          $("#scoreLine").textContent =
            "could not reach API — is the live server / tunnel up?";
          $("#turnBanner").textContent = "offline";
          setPlaying(false);
          closeStream();
        }
      }
    };
  }

  /** Replay last completed game client-side — no API calls. */
  function startReplay() {
    if (live || replaying) return;
    if (!storedGame || !storedGame.plies || !storedGame.plies.length) return;
    closeStream();
    resetBoard();
    setColors(storedGame.white, storedGame.black);
    setReplaying(true);
    $("#scoreLine").textContent = `REPLAY · ${shortName(storedGame.white)} (W) vs ${shortName(storedGame.black)} (B)`;
    $("#turnBanner").textContent = `${shortName(storedGame.white)} to move  ♔ White`;
    $("#jevWdl").textContent = "replay";
    $("#layaWdl").textContent = "replay";
    $("#footerNote").textContent =
      "replay · " + storedGame.plies.length + " plies · no API";

    storedGame.plies.forEach((ply) => enqueuePly(ply));
    enqueueEnd(
      storedGame.end || {
        result: "*",
        plies: storedGame.plies.length,
        white: storedGame.white,
        black: storedGame.black,
      }
    );
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
          if (live || replaying) return;
          const last = (g.plies || [])[(g.plies || []).length - 1];
          setColors(g.white, g.black);
          if (last && last.fen_after && board) board.position(last.fen_after, false);
          $("#scoreLine").textContent = `replay · Game ${i + 1} · ${g.result || "*"}`;
          $("#matchMeta").textContent = "static JSON (not live)";
          const badge = $("#resultBadge");
          badge.hidden = false;
          badge.textContent = `RESULT ${g.result || "*"}`;
          showWinner({
            result: g.result,
            white: g.white,
            black: g.black,
            termination: g.termination,
          });
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
    $("#btnReplay").addEventListener("click", startReplay);
    const slider = $("#speedSlider");
    if (slider) {
      slider.addEventListener("input", () => setPaceMs(slider.value));
      slider.addEventListener("change", () => setPaceMs(slider.value));
    }
    setPaceMs(slider ? slider.value : PACE_DEFAULT_MS);
    updateControlButtons();
    document.addEventListener("keydown", (e) => {
      if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        if (!live && !replaying) startLiveGame();
      }
      if ((e.key === "r" || e.key === "R") && !live && !replaying) {
        startReplay();
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
