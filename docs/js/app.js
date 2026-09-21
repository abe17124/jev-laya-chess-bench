/* Jev vs Laya Chess Bench — static GitHub Pages viewer */
(function () {
  "use strict";

  const DEMOS = [
    {
      id: "laya_vs_random",
      title: "Laya vs Random",
      subtitle: "System One (Laya) · 12 plies · draw @ max_plies",
      path: "data/laya_vs_random.json",
      gameIndex: 0,
    },
    {
      id: "random_vs_random",
      title: "Random vs Random",
      subtitle: "Decisive checkmate in 29 plies (seed 7)",
      path: "data/random_vs_random.json",
      gameIndex: 0,
    },
  ];

  const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

  // Latency → delay for demo watchability
  const LAT_MIN_MS = 180;
  const LAT_MAX_MS = 1400;
  const LAT_SCALE = 0.55; // model latencies (~500ms) stay readable; random snaps scaled up via floor

  let board = null;
  let chess = null;
  let matchData = null;
  let game = null;
  let plyIndex = 0; // 0 = start position; N = after Nth ply
  let playing = false;
  let playTimer = null;
  let speed = 1;
  let cache = {};

  const $ = (sel) => document.querySelector(sel);

  function playerColor(name) {
    const n = (name || "").toLowerCase();
    if (n.startsWith("laya")) return "var(--laya)";
    if (n.startsWith("jev")) return "var(--jev)";
    return "var(--random)";
  }

  function renderScoreboard(scoreboard) {
    const el = $("#scoreboard");
    el.innerHTML = "";
    const entries = Object.values(scoreboard || {});
    if (!entries.length) {
      el.innerHTML = '<div class="card"><span class="muted">No scoreboard</span></div>';
      return;
    }
    for (const s of entries) {
      const card = document.createElement("div");
      card.className = "card";
      const pname = s.name || "player";
      card.innerHTML = `
        <div class="name" data-player="${escapeAttr(pname)}"><span class="dot"></span>${escapeHtml(pname)}</div>
        <div class="stats">
          <div><span class="n">${s.W ?? 0}</span><span class="l">Wins</span></div>
          <div><span class="n">${s.D ?? 0}</span><span class="l">Draws</span></div>
          <div><span class="n">${s.L ?? 0}</span><span class="l">Losses</span></div>
        </div>
        <div class="lat">
          <span>avg <strong>${fmtMs(s.avg_ms)}</strong></span>
          <span>p50 <strong>${fmtMs(s.p50_ms)}</strong></span>
          <span>illegal <strong>${s.illegal ?? 0}</strong></span>
        </div>`;
      el.appendChild(card);
    }
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

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function escapeAttr(s) {
    return escapeHtml(s).replace(/'/g, "&#39;");
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

  function delayForPly(ply) {
    const raw = Math.max(0, +(ply && ply.latency_ms) || 0);
    // Scale: random (~0ms) → LAT_MIN; model (~400–500) → ~220–275; cap LAT_MAX
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

  function setPosition(index, animate) {
    plyIndex = Math.max(0, Math.min(index, plies().length));
    const fen = fenAt(plyIndex);
    if (chess) chess.load(fen);
    if (board) {
      board.position(fen, animate !== false);
    }
    $("#scrub").value = String(plyIndex);
    $("#plyLabel").textContent = `Ply ${plyIndex} / ${plies().length}`;
    updateHud();
    updateResultBadge();
  }

  function updateHud() {
    const list = plies();
    if (plyIndex === 0) {
      $("#hPlayer").textContent = "—";
      $("#hColor").textContent = "starting position";
      $("#hUci").textContent = "—";
      $("#hSan").textContent = "—";
      $("#hConf").textContent = "—";
      $("#hLat").textContent = "—";
      $("#latFill").style.width = "0%";
      $("#probs").innerHTML = '<p class="muted">Press play or step to see move HUD.</p>';
      return;
    }
    const ply = list[plyIndex - 1];
    if (!ply) return;
    $("#hPlayer").textContent = ply.player || "—";
    $("#hPlayer").style.color = playerColor(ply.player);
    $("#hColor").textContent = ply.color || "—";
    $("#hUci").textContent = ply.uci || "—";
    $("#hSan").textContent = ply.san || "—";
    $("#hConf").textContent =
      ply.confidence == null ? "—" : (+ply.confidence).toFixed(4);
    $("#hLat").textContent = fmtMs(ply.latency_ms);

    // Latency bar relative to match max (cap visual at 1000ms for random+model mix)
    const maxLat = Math.max(
      500,
      ...list.map((p) => +p.latency_ms || 0).filter((x) => x > 0),
      1
    );
    const pct = Math.min(100, ((+ply.latency_ms || 0) / maxLat) * 100);
    $("#latFill").style.width = pct + "%";

    renderProbs(ply);
  }

  function renderProbs(ply) {
    const box = $("#probs");
    const probs = ply.probabilities || {};
    const entries = Object.entries(probs)
      .map(([uci, p]) => ({ uci, p: +p }))
      .filter((e) => !Number.isNaN(e.p))
      .sort((a, b) => b.p - a.p)
      .slice(0, 12);
    if (!entries.length) {
      box.innerHTML = '<p class="muted">No probabilities for this ply.</p>';
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
    if (!game) {
      badge.hidden = true;
      return;
    }
    if (plyIndex < plies().length) {
      badge.hidden = true;
      return;
    }
    badge.hidden = false;
    const r = game.result || "*";
    const t = game.termination || "";
    badge.textContent = `Result ${r}${t ? " · " + t : ""}`;
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
    const nextPly = plies()[plyIndex]; // about to play this one
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

  async function fetchDemo(demo) {
    if (cache[demo.id]) return cache[demo.id];
    const res = await fetch(demo.path);
    if (!res.ok) throw new Error(`Failed to load ${demo.path}: ${res.status}`);
    const data = await res.json();
    cache[demo.id] = data;
    return data;
  }

  async function loadDemo(id) {
    stopPlay();
    const demo = DEMOS.find((d) => d.id === id) || DEMOS[0];
    renderMatchList(demo.id);
    try {
      matchData = await fetchDemo(demo);
      game = (matchData.games_detail || [])[demo.gameIndex || 0];
      if (!game) throw new Error("No game in artifact");
      renderScoreboard(matchData.scoreboard);
      $("#matchMeta").innerHTML = `
        <div><strong>${escapeHtml(game.white)}</strong> (White) vs <strong>${escapeHtml(game.black)}</strong> (Black)</div>
        <div style="margin-top:.35rem">Result <strong>${escapeHtml(game.result || "*")}</strong>
          · ${escapeHtml(game.termination || "")}
          · ${plies().length} plies
          · seed ${escapeHtml(String(matchData.seed ?? "—"))}</div>`;
      $("#scrub").max = String(plies().length);
      setPosition(0, false);
    } catch (err) {
      console.error(err);
      $("#matchMeta").innerHTML = `<span style="color:var(--danger)">${escapeHtml(err.message)}</span>`;
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

  function boot() {
    initBoard();
    wireControls();
    renderMatchList(DEMOS[0].id);
    loadDemo(DEMOS[0].id);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
