const COLS = 6;
const VISIBLE_ROWS = 12;
const HIDDEN_ROWS = 1;
const ROWS = VISIBLE_ROWS + HIDDEN_ROWS;
const START_INTERVAL = 760;
const MIN_INTERVAL = 250;
const COLORS = ["red", "green", "blue", "yellow", "violet"];
const HIGH_SCORE_KEY = "puyo-browser-high-score";
const PLAYER_NAME_KEY = "puyo-browser-player-name";
const LEADERBOARD_API = "https://puyo-puyo-leaderboard.inoa-ai.workers.dev";
const CLEAR_ANIMATION_MS = 260;
const FALL_ANIMATION_BASE_MS = 360;
const FALL_ANIMATION_PER_ROW_MS = 95;
const FALL_ANIMATION_MAX_MS = 980;
const CHAIN_POWER = [0, 0, 8, 16, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, 480, 512];
const PUYO = {
  red: { fill: "#ef5c4f", shade: "#b72f2e" },
  green: { fill: "#22b99a", shade: "#147964" },
  blue: { fill: "#4589ff", shade: "#2550b8" },
  yellow: { fill: "#f5bd38", shade: "#b98016" },
  violet: { fill: "#8758ff", shade: "#5a35bc" },
};
const DIRS = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

const boardCanvas = document.querySelector("#board");
const nextCanvas = document.querySelector("#next");
const boardCtx = boardCanvas.getContext("2d");
const nextCtx = nextCanvas.getContext("2d");

const els = {
  score: document.querySelector("#score"),
  highScore: document.querySelector("#high-score"),
  chain: document.querySelector("#chain"),
  level: document.querySelector("#level"),
  status: document.querySelector("#status"),
  start: document.querySelector("#start"),
  pause: document.querySelector("#pause"),
  restart: document.querySelector("#restart"),
  leaderboardList: document.querySelector("#leaderboard-list"),
  leaderboardStatus: document.querySelector("#leaderboard-status"),
  refreshRanking: document.querySelector("#refresh-ranking"),
  scoreForm: document.querySelector("#score-form"),
  playerName: document.querySelector("#player-name"),
};

let board;
let active;
let queue;
let score;
let highScore;
let chainDisplay;
let level;
let state;
let dropTimer;
let lastTime;
let resolving;
let pendingLeaderboardScore;
let clearAnimation;
let clearingCells;
let fallingPuyos;

function emptyBoard() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
}

function randomPair() {
  return {
    pivot: COLORS[Math.floor(Math.random() * COLORS.length)],
    child: COLORS[Math.floor(Math.random() * COLORS.length)],
  };
}

function ensureQueue() {
  while (queue.length < 3) queue.push(randomPair());
}

function pairCells(piece = active) {
  if (!piece) return [];
  const d = DIRS[piece.rotation];
  return [
    { x: piece.x, y: piece.y, color: piece.pivot },
    { x: piece.x + d.x, y: piece.y + d.y, color: piece.child },
  ];
}

function isInside(x, y) {
  return x >= 0 && x < COLS && y >= 0 && y < ROWS;
}

function canOccupy(piece) {
  return pairCells(piece).every(({ x, y }) => isInside(x, y) && !board[y][x]);
}

function spawnPiece() {
  ensureQueue();
  const pair = queue.shift();
  ensureQueue();
  active = {
    x: 2,
    y: 1,
    rotation: 0,
    pivot: pair.pivot,
    child: pair.child,
  };

  if (!canOccupy(active)) {
    active = null;
    state = "gameover";
    handleGameOver();
  }
}

function resetGame() {
  highScore = readHighScore();
  board = emptyBoard();
  active = null;
  queue = [randomPair(), randomPair(), randomPair()];
  score = 0;
  chainDisplay = 0;
  level = 1;
  state = "ready";
  dropTimer = 0;
  lastTime = performance.now();
  resolving = false;
  pendingLeaderboardScore = 0;
  clearAnimation = null;
  clearingCells = new Set();
  fallingPuyos = [];
  hideScoreForm();
  spawnPiece();
  state = "ready";
  setStatus("READY");
  updateHud();
  draw();
}

function startGame() {
  if (state === "gameover") resetGame();
  state = "running";
  setStatus("GO");
}

function togglePause() {
  if (state === "running") {
    state = "paused";
    setStatus("PAUSE");
    return;
  }
  if (state === "paused") {
    state = "running";
    setStatus("GO");
  }
}

function setStatus(text) {
  els.status.textContent = text;
}

function updateHud() {
  if (score > highScore) {
    highScore = score;
    saveHighScore();
  }
  els.score.textContent = score.toLocaleString();
  els.highScore.textContent = highScore.toLocaleString();
  els.chain.textContent = chainDisplay;
  els.level.textContent = level;
}

function readHighScore() {
  try {
    const stored = Number.parseInt(localStorage.getItem(HIGH_SCORE_KEY) ?? "0", 10);
    return Number.isFinite(stored) && stored > 0 ? stored : 0;
  } catch {
    return 0;
  }
}

function saveHighScore() {
  try {
    localStorage.setItem(HIGH_SCORE_KEY, String(highScore));
  } catch {
    // Some private browsing modes disable storage. The game should still run.
  }
}

function readPlayerName() {
  try {
    return localStorage.getItem(PLAYER_NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

function savePlayerName(name) {
  try {
    localStorage.setItem(PLAYER_NAME_KEY, name);
  } catch {
    // Player names are optional; storage may be disabled.
  }
}

function handleGameOver() {
  saveHighScore();
  setStatus("GAME OVER");
  if (score > 0) showScoreForm(score);
}

function showScoreForm(finalScore) {
  pendingLeaderboardScore = finalScore;
  els.playerName.value = readPlayerName();
  els.scoreForm.classList.remove("is-hidden");
  setLeaderboardStatus("NEW SCORE");
}

function hideScoreForm() {
  pendingLeaderboardScore = 0;
  els.scoreForm.classList.add("is-hidden");
}

function setLeaderboardStatus(text) {
  els.leaderboardStatus.textContent = text;
}

async function loadLeaderboard() {
  setLeaderboardStatus("LOADING");
  try {
    const response = await fetch(`${LEADERBOARD_API}/leaderboard`, { cache: "no-store" });
    if (!response.ok) throw new Error("ranking load failed");
    const data = await response.json();
    renderLeaderboard(data.scores ?? []);
    setLeaderboardStatus("");
  } catch {
    renderLeaderboard([]);
    setLeaderboardStatus("OFFLINE");
  }
}

function renderLeaderboard(scores) {
  els.leaderboardList.innerHTML = "";

  if (!scores.length) {
    const item = document.createElement("li");
    item.className = "empty-rank";
    item.textContent = "NO SCORES";
    els.leaderboardList.append(item);
    return;
  }

  scores.forEach((entry, index) => {
    const item = document.createElement("li");
    const rank = document.createElement("span");
    const name = document.createElement("span");
    const value = document.createElement("span");

    rank.textContent = `${index + 1}`;
    name.textContent = entry.name;
    value.textContent = Number(entry.score).toLocaleString();

    item.append(rank, name, value);
    els.leaderboardList.append(item);
  });
}

async function submitLeaderboardScore(event) {
  event.preventDefault();
  if (!pendingLeaderboardScore) return;

  const name = normalizePlayerName(els.playerName.value);
  els.playerName.value = name;
  savePlayerName(name);
  setLeaderboardStatus("SENDING");

  try {
    const response = await fetch(`${LEADERBOARD_API}/scores`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, score: pendingLeaderboardScore }),
    });
    if (!response.ok) throw new Error("score submit failed");
    const data = await response.json();
    renderLeaderboard(data.scores ?? []);
    hideScoreForm();
    setLeaderboardStatus("SENT");
  } catch {
    setLeaderboardStatus("TRY AGAIN");
  }
}

function normalizePlayerName(value) {
  const name = value.replace(/\s+/g, " ").trim().slice(0, 16);
  return name || "PLAYER";
}

function tryMove(dx, dy) {
  if (state !== "running" || resolving || !active) return false;
  const next = { ...active, x: active.x + dx, y: active.y + dy };
  if (!canOccupy(next)) return false;
  active = next;
  draw();
  return true;
}

function tryRotate() {
  if (state !== "running" || resolving || !active) return;
  const rotated = { ...active, rotation: (active.rotation + 1) % 4 };
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    const candidate = { ...rotated, x: rotated.x + kick };
    if (canOccupy(candidate)) {
      active = candidate;
      draw();
      return;
    }
  }
}

function hardDrop() {
  if (state !== "running" || resolving || !active) return;
  let distance = 0;
  while (tryMove(0, 1)) distance += 1;
  score += distance * 2;
  lockPiece();
}

function lockPiece() {
  if (!active) return;
  for (const cell of pairCells()) {
    board[cell.y][cell.x] = cell.color;
  }
  active = null;
  updateHud();
  resolveBoard();
}

async function resolveBoard() {
  resolving = true;
  let chain = 0;

  await animateGravity();

  while (true) {
    const groups = findClearGroups();
    if (!groups.length) break;
    chain += 1;
    chainDisplay = chain;
    const cleared = groups.reduce((sum, group) => sum + group.length, 0);
    score += calculateClearScore(cleared, groups.length, chain);
    level = Math.max(1, Math.floor(score / 1200) + 1);
    updateHud();
    await animateClear(groups);
    clearMarked();
    await animateGravity();
  }

  if (chain > 1) {
    setStatus(`${chain} CHAIN`);
    await wait(420);
  }
  chainDisplay = 0;
  resolving = false;
  updateHud();

  if (state !== "gameover") {
    spawnPiece();
    if (state === "running") setStatus("GO");
    draw();
  }
}

function calculateClearScore(cleared, groupCount, chain) {
  const base = cleared * 10;
  const bonus = Math.max(1, chainBonus(chain) + groupBonus(groupCount));
  return base * bonus;
}

function chainBonus(chain) {
  return CHAIN_POWER[Math.min(chain, CHAIN_POWER.length - 1)];
}

function groupBonus(groupCount) {
  return Math.max(0, groupCount - 1) * 2;
}

function findClearGroups() {
  const seen = Array.from({ length: ROWS }, () => Array(COLS).fill(false));
  const groups = [];

  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      const color = board[y][x];
      if (!color || seen[y][x]) continue;
      const group = [];
      const stack = [{ x, y }];
      seen[y][x] = true;

      while (stack.length) {
        const current = stack.pop();
        group.push(current);
        for (const d of DIRS) {
          const nx = current.x + d.x;
          const ny = current.y + d.y;
          if (!isInside(nx, ny) || seen[ny][nx] || board[ny][nx] !== color) continue;
          seen[ny][nx] = true;
          stack.push({ x: nx, y: ny });
        }
      }

      if (group.length >= 4) groups.push(group);
    }
  }

  return groups;
}

function markClear(groups) {
  clearingCells = new Set();
  for (const group of groups) {
    for (const { x, y } of group) {
      clearingCells.add(cellKey(x, y));
    }
  }
}

async function animateClear(groups) {
  markClear(groups);
  const startedAt = performance.now();

  while (true) {
    const elapsed = performance.now() - startedAt;
    clearAnimation = {
      progress: Math.min(1, elapsed / CLEAR_ANIMATION_MS),
    };
    draw();
    if (clearAnimation.progress >= 1) break;
    await nextFrame();
  }

  clearAnimation = null;
}

function clearMarked() {
  for (const key of clearingCells) {
    const [x, y] = key.split(":").map(Number);
    board[y][x] = null;
  }
  clearingCells.clear();
}

function settleGravity() {
  const drops = [];

  for (let x = 0; x < COLS; x += 1) {
    const settled = Array(ROWS).fill(null);
    let writeY = ROWS - 1;

    for (let y = ROWS - 1; y >= 0; y -= 1) {
      if (!board[y][x]) continue;
      settled[writeY] = board[y][x];
      if (writeY !== y) {
        drops.push({
          x,
          fromY: y,
          toY: writeY,
          color: board[y][x],
        });
      }
      writeY -= 1;
    }

    for (let y = ROWS - 1; y >= 0; y -= 1) {
      board[y][x] = settled[y];
    }
  }

  return drops;
}

async function animateGravity() {
  const drops = settleGravity();
  if (!drops.length) return false;

  fallingPuyos = drops;
  const startedAt = performance.now();
  const maxDrop = Math.max(...drops.map((drop) => drop.toY - drop.fromY));
  const duration = Math.min(FALL_ANIMATION_MAX_MS, FALL_ANIMATION_BASE_MS + maxDrop * FALL_ANIMATION_PER_ROW_MS);

  while (true) {
    const elapsed = performance.now() - startedAt;
    const progress = Math.min(1, elapsed / duration);
    const eased = easeInOutCubic(progress);
    fallingPuyos = drops.map((drop) => ({
      ...drop,
      yOffset: (drop.fromY - drop.toY) * (1 - eased),
    }));
    draw();
    if (progress >= 1) break;
    await nextFrame();
  }

  fallingPuyos = [];
  draw();
  await wait(90);
  return true;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

function easeInOutCubic(value) {
  return value < 0.5 ? 4 * value ** 3 : 1 - Math.pow(-2 * value + 2, 3) / 2;
}

function tick(now) {
  const delta = Math.min(40, now - lastTime);
  lastTime = now;

  if (state === "running" && !resolving) {
    dropTimer += delta;
    const interval = Math.max(MIN_INTERVAL, START_INTERVAL - (level - 1) * 42);
    if (dropTimer >= interval) {
      dropTimer = 0;
      if (!tryMove(0, 1)) lockPiece();
    }
  }

  draw();
  requestAnimationFrame(tick);
}

function fitCanvas(canvas, ctx) {
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(rect.width * ratio));
  const height = Math.max(1, Math.round(rect.height * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { width: rect.width, height: rect.height };
}

function draw() {
  drawBoard();
  drawNext();
}

function drawBoard() {
  const { width, height } = fitCanvas(boardCanvas, boardCtx);
  const cell = Math.min(width / COLS, height / VISIBLE_ROWS);
  const offsetX = (width - cell * COLS) / 2;
  const offsetY = (height - cell * VISIBLE_ROWS) / 2;

  boardCtx.clearRect(0, 0, width, height);
  boardCtx.fillStyle = "#132226";
  boardCtx.fillRect(0, 0, width, height);

  for (let y = 0; y < VISIBLE_ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      const px = offsetX + x * cell;
      const py = offsetY + y * cell;
      drawCellSlot(boardCtx, px, py, cell);
      const boardY = y + HIDDEN_ROWS;
      const color = board[boardY][x];
      if (color && !isFallingTarget(x, boardY)) {
        drawPuyo(boardCtx, px, py, cell, color, isClearingCell(x, boardY));
      }
    }
  }

  for (const puyo of fallingPuyos) {
    if (puyo.toY < HIDDEN_ROWS) continue;
    const px = offsetX + puyo.x * cell;
    const py = offsetY + (puyo.toY - HIDDEN_ROWS + puyo.yOffset) * cell;
    drawPuyo(boardCtx, px, py, cell, puyo.color);
  }

  if (active) {
    drawGhost(boardCtx, offsetX, offsetY, cell);
    for (const { x, y, color } of pairCells()) {
      if (y < HIDDEN_ROWS) continue;
      drawPuyo(boardCtx, offsetX + x * cell, offsetY + (y - HIDDEN_ROWS) * cell, cell, color);
    }
  }
}

function isFallingTarget(x, y) {
  return fallingPuyos.some((puyo) => puyo.x === x && puyo.toY === y);
}

function isClearingCell(x, y) {
  return clearingCells.has(cellKey(x, y));
}

function cellKey(x, y) {
  return `${x}:${y}`;
}

function drawCellSlot(ctx, x, y, size) {
  const pad = Math.max(2, size * 0.06);
  ctx.fillStyle = "rgba(255,255,255,0.045)";
  roundedRect(ctx, x + pad, y + pad, size - pad * 2, size - pad * 2, size * 0.16);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawGhost(ctx, offsetX, offsetY, cell) {
  let ghost = { ...active };
  while (canOccupy({ ...ghost, y: ghost.y + 1 })) ghost.y += 1;
  ctx.globalAlpha = 0.23;
  for (const { x, y } of pairCells(ghost)) {
    if (y < HIDDEN_ROWS) continue;
    const px = offsetX + x * cell;
    const py = offsetY + (y - HIDDEN_ROWS) * cell;
    roundedRect(ctx, px + cell * 0.16, py + cell * 0.16, cell * 0.68, cell * 0.68, cell * 0.32);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawPuyo(ctx, x, y, size, color, clearing = false) {
  const palette = PUYO[color] ?? { fill: "#ffffff", shade: "#f5bd38" };
  const clearProgress = clearing ? (clearAnimation?.progress ?? 0) : 0;
  const pulse = clearing ? Math.sin(clearProgress * Math.PI * 3) * 0.12 : 0;
  const scale = clearing ? Math.max(0.08, 1 + pulse - clearProgress * 0.82) : 1;
  const scaledSize = size * scale;
  const drawX = x + (size - scaledSize) / 2;
  const drawY = y + (size - scaledSize) / 2;
  const pad = scaledSize * 0.09;
  const body = scaledSize - pad * 2;
  ctx.save();
  if (clearing) {
    ctx.globalAlpha = Math.max(0, 1 - clearProgress * 0.72);
  }
  ctx.fillStyle = "rgba(0,0,0,0.2)";
  roundedRect(ctx, drawX + pad * 1.3, drawY + pad * 1.55, body, body, scaledSize * 0.32);
  ctx.fill();
  const grad = ctx.createRadialGradient(
    drawX + scaledSize * 0.38,
    drawY + scaledSize * 0.3,
    scaledSize * 0.08,
    drawX + scaledSize * 0.5,
    drawY + scaledSize * 0.55,
    scaledSize * 0.5,
  );
  grad.addColorStop(0, "#ffffff");
  grad.addColorStop(0.18, palette.fill);
  grad.addColorStop(1, palette.shade);
  ctx.fillStyle = grad;
  roundedRect(ctx, drawX + pad, drawY + pad, body, body, scaledSize * 0.34);
  ctx.fill();
  ctx.lineWidth = Math.max(2, scaledSize * 0.055);
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.stroke();
  drawFace(ctx, drawX, drawY, scaledSize);
  if (clearing) drawClearSpark(ctx, x, y, size, clearProgress);
  ctx.restore();
}

function drawClearSpark(ctx, x, y, size, progress) {
  const centerX = x + size / 2;
  const centerY = y + size / 2;
  const radius = size * (0.16 + progress * 0.34);
  ctx.globalAlpha = Math.max(0, 0.65 - progress * 0.65);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = Math.max(1.2, size * 0.035);

  for (let i = 0; i < 6; i += 1) {
    const angle = (Math.PI * 2 * i) / 6 + progress * 1.6;
    const inner = radius * 0.45;
    ctx.beginPath();
    ctx.moveTo(centerX + Math.cos(angle) * inner, centerY + Math.sin(angle) * inner);
    ctx.lineTo(centerX + Math.cos(angle) * radius, centerY + Math.sin(angle) * radius);
    ctx.stroke();
  }
}

function drawFace(ctx, x, y, size) {
  ctx.fillStyle = "#10191d";
  const eye = Math.max(2, size * 0.055);
  ctx.beginPath();
  ctx.arc(x + size * 0.39, y + size * 0.48, eye, 0, Math.PI * 2);
  ctx.arc(x + size * 0.61, y + size * 0.48, eye, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(16,25,29,0.65)";
  ctx.lineWidth = Math.max(1.4, size * 0.035);
  ctx.beginPath();
  ctx.arc(x + size * 0.5, y + size * 0.58, size * 0.09, 0.1, Math.PI - 0.1);
  ctx.stroke();
}

function drawNext() {
  const { width, height } = fitCanvas(nextCanvas, nextCtx);
  nextCtx.clearRect(0, 0, width, height);
  const pair = queue[0];
  if (!pair) return;
  const size = Math.min(width * 0.62, height * 0.34, 58);
  const x = width / 2 - size / 2;
  const y = height / 2 - size * 0.92;
  drawPuyo(nextCtx, x, y, size, pair.child);
  drawPuyo(nextCtx, x, y + size * 0.86, size, pair.pivot);
}

function roundedRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function handleAction(action) {
  if (state === "ready" && action !== "restart") startGame();
  if (action === "left") tryMove(-1, 0);
  if (action === "right") tryMove(1, 0);
  if (action === "down") {
    if (tryMove(0, 1)) score += 1;
    else if (state === "running" && !resolving) lockPiece();
    updateHud();
  }
  if (action === "rotate") tryRotate();
  if (action === "drop") hardDrop();
}

window.addEventListener("keydown", (event) => {
  const keys = ["ArrowLeft", "ArrowRight", "ArrowDown", "ArrowUp", " ", "z", "Z", "p", "P", "Enter"];
  if (!keys.includes(event.key)) return;
  event.preventDefault();

  if (event.key === "Enter") startGame();
  if (event.key === "p" || event.key === "P") togglePause();
  if (event.key === "ArrowLeft") handleAction("left");
  if (event.key === "ArrowRight") handleAction("right");
  if (event.key === "ArrowDown") handleAction("down");
  if (event.key === "ArrowUp" || event.key === "z" || event.key === "Z") handleAction("rotate");
  if (event.key === " ") handleAction("drop");
});

els.start.addEventListener("click", startGame);
els.pause.addEventListener("click", togglePause);
els.restart.addEventListener("click", () => {
  resetGame();
  startGame();
});
els.refreshRanking.addEventListener("click", loadLeaderboard);
els.scoreForm.addEventListener("submit", submitLeaderboardScore);

document.querySelectorAll("[data-action]").forEach((button) => {
  const run = () => handleAction(button.dataset.action);
  button.addEventListener("click", run);
});

window.addEventListener("resize", draw);

resetGame();
loadLeaderboard();
requestAnimationFrame(tick);
