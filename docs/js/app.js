/* JEV vs LAYA — chess (static Pages viewer) */
(function () {
  "use strict";

  // Populated after match JSON loads; one entry per game
  let DEMOS = [];
  const MATCH_PATH = "data/jev_vs_laya.json";
  const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

  const LAT_MIN_MS = 180;
  const LAT_MAX_MS = 1400;
  const LAT_SCALE = 0.55;

  let board = null;
  let chess = null;
  let matchData = null;
  let game = null;
  let plyIndex = 0;
  let playing = false;
  let playTimer = null;
  let speed = 1;
  let activeDemoId = null;

  const $ = (sel) => document.querySelector(sel);

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
  function normName(n) {
    return String(n || "").toLowerCase();
  }
  function isJev(n) {
    return normName(n).startsWith("jev");
  }
  function isLaya(n) {
    return normName(n).startsWith("laya");
  }

  function colorGlyph(side) {
    // White king / Black king
    return side === "white" ? "♔" : "♚";
  }
  function colorLabel(side) {
    return side === "white" ? "White" : "Black";
  }

  function updatePlayerHeaders(g, scoreboard) {
    if (!g) return;
    const white = g.white;
    const black = g.black;

    const setCard = (playerKey, side) => {
      const colorEl = $(playerKey === "jev" ? "#jevColor" : "#layaColor");
      const card = $(playerKey === "jev" ? "#cardJev" : "#cardLaya");
      colorEl.textContent = `${colorGlyph(side)} ${colorLabel(side)}`;
      card.setAttribute("data-side", side);
    };

    if (isJev(white)) setCard("jev", "white");
    else if (isJev(black)) setCard("jev", "black");

    if (isLaya(white)) setCard("laya", "white");
    else if (isLaya(black)) setCard("laya", "black");

    const sb = scoreboard || {};
    const findSb = (pred) => {
      for (const v of Object.values(sb)) {
        if (pred(v.name)) return v;
      }
      return null;
    };
    const jev = findSb(isJev);
    const laya = findSb(isLaya);
    if (jev) {
      $("#jevWdl").textContent = `${jev.W ?? 0}–${jev.D ?? 0}–${jev.L ?? 0}`;
      $("#jevAvg").textContent = `avg ${fmtMs(jev.avg_ms)}`;
    }
    if (laya) {
      $("#layaWdl").textContent = `${laya.W ?? 0}–${laya.D ?? 0}–${laya.L ?? 0}`;
      $("#layaAvg").textContent = `avg ${fmtMs(laya.avg_ms)}`;
    }

    // Big score strip
    const jW = jev ? jev.W ?? 0 : 0;
    const lW = laya ? laya.W ?? 0 : 0;
    const draws = jev ? jev.D ?? 0 : laya ? laya.D ?? 0 : 0;
    $("#scoreLine").textContent = `JEV ${jW}  ·  DRAW ${draws}  ·  LAYA ${lW}`;
  }

  function renderMatchList(activeId) {
    const list = $("#matchList");
    list.innerHTML = "";
    for (const d of DEMOS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "match-btn" + (d.id === activeId ? " active" : "");
      btn.setAttribute("role", "option");
      btn.setAttribute("aria-selected", d.id === activeId ? "true" : "false");
      btn.innerHTML = `<span class="t">${escapeHtml(d.title)}</span><span class="s">${escapeHtml(d.subtitle)}</span>`;
      btn.addEventListener("click", () => loadDemo(d.id));
      list.appendChild(btn);
    }
  }

  function delayForPly(ply) {
    const raw = Math.max(0, +(ply && ply.latency_ms) || 0);
    const scaled = Math.min(LAT_MAX_MS, Math.max(LAT_MIN_MS, raw * LAT_SCALE + LAT_MIN_MS * 0.35));
    return scaled / speed;
  }

  function plies() {
    return (game && game.plies) || [];
  }

  function fenAt(index) {
    if (index <= 0) return START_FEN;
    const p = plies()[index - 1];
    return (p && p.fen_after) || START_FEN;
  }

  function whoseTurnAt(index) {
    // Before any ply: white to move. After a ply, next side from fen or opposite of last ply color.
    if (index <= 0) return { side: "white", player: game ? game.white : "—" };
    if (index >= plies().length) return null; // game over
    const next = plies()[index];
    if (next) {
      return { side: next.color || "white", player: next.player || "—" };
    }
    return null;
  }

  function setPosition(index, animate) {
    plyIndex = Math.max(0, Math.min(index, plies().length));
    const fen = fenAt(plyIndex);
    if (chess) chess.load(fen);
    if (board) board.position(fen, animate !== false);
    $("#scrub").value = String(plyIndex);
    $("#plyLabel").textContent = `ply ${plyIndex}/${plies().length}`;
    updateHud();
    updateResultBadge();
    updateTurnBanner();
  }

  function updateTurnBanner() {
    const turn = whoseTurnAt(plyIndex);
    const el = $("#turnBanner");
    if (!turn) {
      el.textContent = "game over";
      return;
    }
    const g = colorGlyph(turn.side);
    const label = colorLabel(turn.side);
    const name = (turn.player || "").toUpperCase();
    el.textContent = `${name} to move  ${g} ${label}`;
  }

  function updateHud() {
    const list = plies();
    if (plyIndex === 0) {
      $("#hMove").textContent = "start";
      $("#hPlayer").textContent = "—";
      $("#hLat").textContent = "—";
      $("#hUci").textContent = "—";
      $("#hConf").textContent = "—";
      $("#probs").innerHTML = "";
      return;
    }
    const ply = list[plyIndex - 1];
    if (!ply) return;
    const san = ply.san || ply.uci || "—";
    $("#hMove").textContent = san;
    $("#hPlayer").textContent = (ply.player || "—").toUpperCase();
    $("#hPlayer").style.color = isJev(ply.player) ? "var(--jev)" : isLaya(ply.player) ? "var(--laya)" : "inherit";
    $("#hLat").textContent = fmtMs(ply.latency_ms);
    $("#hUci").textContent = ply.uci || "—";
    $("#hConf").textContent = ply.confidence == null ? "—" : (+ply.confidence).toFixed(4);
    renderProbs(ply);
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

  function updateResultBadge() {
    const badge = $("#resultBadge");
    if (!game || plyIndex < plies().length) {
      badge.hidden = true;
      return;
    }
    badge.hidden = false;
    const r = game.result || "*";
    const t = game.termination || "";
    badge.textContent = `RESULT ${r}${t ? " · " + t : ""}`;
  }

  function stopPlay() {
    playing = false;
    if (playTimer) {
      clearTimeout(playTimer);
      playTimer = null;
    }
    const btn = $("#btnPlay");
    btn.textContent = "▶";
    btn.classList.remove("playing");
    btn.title = "Play";
  }

  function scheduleNext() {
    if (!playing) return;
    if (plyIndex >= plies().length) {
      stopPlay();
      return;
    }
    const nextPly = plies()[plyIndex];
    const delay = delayForPly(nextPly);
    playTimer = setTimeout(() => {
      setPosition(plyIndex + 1, true);
      scheduleNext();
    }, delay);
  }

  function togglePlay() {
    if (playing) {
      stopPlay();
      return;
    }
    if (plyIndex >= plies().length) setPosition(0, false);
    playing = true;
    const btn = $("#btnPlay");
    btn.textContent = "❚❚";
    btn.classList.add("playing");
    btn.title = "Pause";
    scheduleNext();
  }

  function buildDemosFromMatch(data) {
    const games = data.games_detail || [];
    return games.map((g, i) => {
      const pliesN = (g.plies || []).length;
      const res = g.result || "*";
      const term = g.termination || "";
      return {
        id: `game_${i + 1}`,
        title: `Game ${i + 1}: ${(g.white || "?").toUpperCase()} vs ${(g.black || "?").toUpperCase()}`,
        subtitle: `${res}${term ? " · " + term : ""} · ${pliesN} plies`,
        gameIndex: i,
      };
    });
  }

  async function loadMatch() {
    const res = await fetch(MATCH_PATH);
    if (!res.ok) throw new Error(`Failed to load ${MATCH_PATH}: ${res.status}`);
    matchData = await res.json();
    DEMOS = buildDemosFromMatch(matchData);
    if (!DEMOS.length) throw new Error("No games in match file");
    return matchData;
  }

  async function loadDemo(id) {
    stopPlay();
    if (!matchData) await loadMatch();
    const demo = DEMOS.find((d) => d.id === id) || DEMOS[0];
    activeDemoId = demo.id;
    renderMatchList(demo.id);
    game = (matchData.games_detail || [])[demo.gameIndex || 0];
    if (!game) throw new Error("No game in artifact");
    updatePlayerHeaders(game, matchData.scoreboard);
    $("#matchMeta").textContent = `${plies().length} plies · seed ${matchData.seed ?? "—"}`;
    $("#scrub").max = String(plies().length);
    setPosition(0, false);
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

  function wireControls() {
    $("#btnStart").addEventListener("click", () => {
      stopPlay();
      setPosition(0, false);
    });
    $("#btnBack").addEventListener("click", () => {
      stopPlay();
      setPosition(plyIndex - 1, true);
    });
    $("#btnFwd").addEventListener("click", () => {
      stopPlay();
      setPosition(plyIndex + 1, true);
    });
    $("#btnEnd").addEventListener("click", () => {
      stopPlay();
      setPosition(plies().length, false);
    });
    $("#btnPlay").addEventListener("click", togglePlay);
    $("#scrub").addEventListener("input", (e) => {
      stopPlay();
      setPosition(+e.target.value, false);
    });
    $("#speed").addEventListener("input", (e) => {
      speed = +e.target.value || 1;
      $("#speedLabel").textContent = speed + "×";
    });
    document.addEventListener("keydown", (e) => {
      if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
      if (e.key === " ") {
        e.preventDefault();
        togglePlay();
      } else if (e.key === "ArrowRight") {
        stopPlay();
        setPosition(plyIndex + 1, true);
      } else if (e.key === "ArrowLeft") {
        stopPlay();
        setPosition(plyIndex - 1, true);
      }
    });
  }

  async function boot() {
    initBoard();
    wireControls();
    try {
      await loadMatch();
      await loadDemo(DEMOS[0].id);
    } catch (err) {
      console.error(err);
      $("#matchMeta").textContent = String(err.message || err);
      $("#scoreLine").textContent = "match data missing — run bench";
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
