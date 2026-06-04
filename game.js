const COLS = 6;
const VISIBLE_ROWS = 12;
const HIDDEN_ROWS = 1;
const ROWS = VISIBLE_ROWS + HIDDEN_ROWS;
const START_INTERVAL = 760;
const MIN_INTERVAL = 250;
const COLORS = ["red", "green", "blue", "yellow", "violet"];
const HIGH_SCORE_KEY = "puyo-browser-high-score";
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
    saveHighScore();
    setStatus("GAME OVER");
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

  if (applyGravity()) {
    draw();
    await wait(120);
  }

  while (true) {
    const groups = findClearGroups();
    if (!groups.length) break;
    chain += 1;
    chainDisplay = chain;
    const cleared = groups.reduce((sum, group) => sum + group.length, 0);
    score += cleared * 10 * chain + Math.max(0, groups.length - 1) * 40;
    level = Math.max(1, Math.floor(score / 1200) + 1);
    updateHud();
    markClear(groups);
    draw();
    await wait(170);
    clearMarked();
    const fell = applyGravity();
    draw();
    await wait(fell ? 150 : 80);
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

function findClearGroups() {
  const seen = Array.from({ length: ROWS }, () => Array(COLS).fill(false));
  const groups = [];

  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      const color = board[y][x];
      if (!color || color === "clear" || seen[y][x]) continue;
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
  for (const group of groups) {
    for (const { x, y } of group) {
      board[y][x] = "clear";
    }
  }
}

function clearMarked() {
  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      if (board[y][x] === "clear") board[y][x] = null;
    }
  }
}

function applyGravity() {
  let moved = false;
  for (let x = 0; x < COLS; x += 1) {
    const settled = Array(ROWS).fill(null);
    let writeY = ROWS - 1;

    for (let y = ROWS - 1; y >= 0; y -= 1) {
      if (!board[y][x]) continue;
      settled[writeY] = board[y][x];
      if (writeY !== y) moved = true;
      writeY -= 1;
    }

    for (let y = ROWS - 1; y >= 0; y -= 1) {
      board[y][x] = settled[y];
    }
  }

  return moved;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
      const color = board[y + HIDDEN_ROWS][x];
      if (color) drawPuyo(boardCtx, px, py, cell, color, color === "clear");
    }
  }

  if (active) {
    drawGhost(boardCtx, offsetX, offsetY, cell);
    for (const { x, y, color } of pairCells()) {
      if (y < HIDDEN_ROWS) continue;
      drawPuyo(boardCtx, offsetX + x * cell, offsetY + (y - HIDDEN_ROWS) * cell, cell, color);
    }
  }
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
  const pad = size * 0.09;
  const body = size - pad * 2;
  ctx.save();
  if (clearing) {
    ctx.globalAlpha = 0.68 + Math.sin(performance.now() / 45) * 0.22;
  }
  ctx.fillStyle = "rgba(0,0,0,0.2)";
  roundedRect(ctx, x + pad * 1.3, y + pad * 1.55, body, body, size * 0.32);
  ctx.fill();
  const grad = ctx.createRadialGradient(
    x + size * 0.38,
    y + size * 0.3,
    size * 0.08,
    x + size * 0.5,
    y + size * 0.55,
    size * 0.5,
  );
  grad.addColorStop(0, "#ffffff");
  grad.addColorStop(0.18, palette.fill);
  grad.addColorStop(1, palette.shade);
  ctx.fillStyle = grad;
  roundedRect(ctx, x + pad, y + pad, body, body, size * 0.34);
  ctx.fill();
  ctx.lineWidth = Math.max(2, size * 0.055);
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.stroke();
  drawFace(ctx, x, y, size);
  ctx.restore();
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
  const size = Math.min(width * 0.34, height * 0.34, 58);
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

document.querySelectorAll("[data-action]").forEach((button) => {
  const run = () => handleAction(button.dataset.action);
  button.addEventListener("click", run);
});

window.addEventListener("resize", draw);

resetGame();
requestAnimationFrame(tick);
