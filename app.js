const CELL_SIZE = 4;
const DARK_INK = "#111216";
const LIGHT_INK = "#92949a";
const DITHER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const SCATTER_RADIUS = 210;
const SCATTER_MIN_DISTANCE = 38;
const SCATTER_DISTANCE_RANGE = 110;
const image = new Image();
image.decoding = "async";
image.src = "assets/rafsan-hero.webp";

const canvas = document.querySelector(".portrait");
const context = canvas.getContext("2d", { alpha: true });
const baseCanvas = document.createElement("canvas");
const baseContext = baseCanvas.getContext("2d", { willReadFrequently: true });
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const finePointer = matchMedia("(hover: hover) and (pointer: fine)");

let particles = [];
let particlesByRow = [];
let width = 0;
let height = 0;
let columns = 0;
let visibleRows = 0;
let frame = null;
let previousTime = null;
let strength = 0;
let targetStrength = 0;
let pointer = { x: 0, y: 0 };
let targetPointer = { x: 0, y: 0 };

function randomAt(index, salt = 0) {
  const value = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453;
  return value - Math.floor(value);
}

function samplePortrait(columns, rows, zoom, visibleRows) {
  const sample = document.createElement("canvas");
  sample.width = columns;
  sample.height = rows;
  const sampleContext = sample.getContext("2d", { willReadFrequently: true });
  const scale = Math.min(columns / image.naturalWidth, rows / image.naturalHeight) * zoom;
  const imageWidth = image.naturalWidth * scale;
  const imageHeight = image.naturalHeight * scale;
  sampleContext.filter = "grayscale(1) contrast(1.22)";
  sampleContext.drawImage(image, (columns - imageWidth) / 2, 0, imageWidth, imageHeight);

  const pixels = sampleContext.getImageData(0, 0, columns, rows).data;
  const nextParticles = [];
  // On desktop, sample at twice the visible height and keep the upper half,
  // matching the original cropped portrait while drawing a smaller canvas.
  for (let row = 0; row < visibleRows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const offset = (row * columns + column) * 4;
      const alpha = pixels[offset + 3] / 255;
      if (alpha < 0.12) continue;

      const luminance = (pixels[offset] * 0.2126 + pixels[offset + 1] * 0.7152 + pixels[offset + 2] * 0.0722) / 255;
      const index = row * columns + column;
      const threshold = (DITHER[(row % 4) * 4 + (column % 4)] + 0.5) / 16;
      const direction = randomAt(index, 1) * Math.PI * 2;
      const scatterAngle = (randomAt(index, 3) - 0.5) * 1.2;
      nextParticles.push({
        index,
        row,
        column,
        x: (column + 0.5) * CELL_SIZE,
        y: (row + 0.5) * CELL_SIZE,
        bit: 1 - luminance > threshold ? "1" : "0",
        ink: luminance > 0.52 ? LIGHT_INK : DARK_INK,
        alpha: alpha * (0.32 + (1 - luminance) ** 0.9 * 0.68),
        scatterX: Math.cos(direction),
        scatterY: Math.sin(direction),
        scatterCos: Math.cos(scatterAngle),
        scatterSin: Math.sin(scatterAngle),
        scatterDistance: SCATTER_MIN_DISTANCE + randomAt(index, 2) * SCATTER_DISTANCE_RANGE,
      });
    }
  }
  return nextParticles;
}

function draw() {
  context.clearRect(0, 0, width, height);
  if (!particles.length) return;
  context.drawImage(baseCanvas, 0, 0, width, height);
  if (strength < 0.001) return;

  const redrawRadius = SCATTER_RADIUS + SCATTER_MIN_DISTANCE + SCATTER_DISTANCE_RANGE;
  context.save();
  context.beginPath();
  context.arc(pointer.x, pointer.y, redrawRadius, 0, Math.PI * 2);
  context.clip();
  context.clearRect(pointer.x - redrawRadius, pointer.y - redrawRadius, redrawRadius * 2, redrawRadius * 2);
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = `700 ${CELL_SIZE * 1.28}px ui-monospace, SFMono-Regular, Menlo, monospace`;

  const firstRow = Math.max(0, Math.floor((pointer.y - redrawRadius) / CELL_SIZE));
  const lastRow = Math.min(visibleRows - 1, Math.ceil((pointer.y + redrawRadius) / CELL_SIZE));
  const firstColumn = Math.max(0, Math.floor((pointer.x - redrawRadius) / CELL_SIZE));
  const lastColumn = Math.min(columns - 1, Math.ceil((pointer.x + redrawRadius) / CELL_SIZE));

  for (let row = firstRow; row <= lastRow; row += 1) {
    for (const particle of particlesByRow[row] ?? []) {
      if (particle.column < firstColumn || particle.column > lastColumn) continue;
      const dx = particle.x - pointer.x;
      const dy = particle.y - pointer.y;
      const distance = Math.hypot(dx, dy);
      if (distance > redrawRadius) continue;
      const scatter = Math.max(0, 1 - distance / SCATTER_RADIUS) ** 1.65 * strength;
      const inverseDistance = distance > 0.001 ? 1 / distance : 0;
      const directionX = distance > 0.001 ? dx * inverseDistance : particle.scatterX;
      const directionY = distance > 0.001 ? dy * inverseDistance : particle.scatterY;
      const x = particle.x + (directionX * particle.scatterCos - directionY * particle.scatterSin) * particle.scatterDistance * scatter;
      const y = particle.y + (directionX * particle.scatterSin + directionY * particle.scatterCos) * particle.scatterDistance * scatter;
      context.globalAlpha = particle.alpha * (1 - scatter * 0.2);
      context.fillStyle = particle.ink;
      context.fillText(particle.bit, x, y);
    }
  }
  context.restore();
}

function animate(time) {
  frame = null;
  const delta = previousTime === null ? 16.67 : Math.min(time - previousTime, 50);
  previousTime = time;
  const blend = 1 - Math.exp(-delta / 180);
  strength += (targetStrength - strength) * blend;
  pointer.x += (targetPointer.x - pointer.x) * blend;
  pointer.y += (targetPointer.y - pointer.y) * blend;
  if (Math.abs(targetStrength - strength) < 0.002) strength = targetStrength;
  if (Math.abs(targetPointer.x - pointer.x) < 0.1) pointer.x = targetPointer.x;
  if (Math.abs(targetPointer.y - pointer.y) < 0.1) pointer.y = targetPointer.y;
  draw();

  if (strength !== targetStrength || pointer.x !== targetPointer.x || pointer.y !== targetPointer.y) {
    frame = requestAnimationFrame(animate);
  } else {
    previousTime = null;
  }
}

function resize() {
  const bounds = canvas.getBoundingClientRect();
  if (!bounds.width || !bounds.height || !image.complete || !image.naturalWidth) return;
  width = bounds.width;
  height = bounds.height;
  const ratio = Math.min(devicePixelRatio || 1, innerWidth < 768 ? 1.5 : 1.75);
  const pixelWidth = Math.round(width * ratio);
  const pixelHeight = Math.round(height * ratio);
  canvas.width = pixelWidth;
  canvas.height = pixelHeight;
  baseCanvas.width = pixelWidth;
  baseCanvas.height = pixelHeight;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  baseContext.setTransform(ratio, 0, 0, ratio, 0, 0);

  columns = Math.ceil(width / CELL_SIZE);
  visibleRows = Math.ceil(height / CELL_SIZE);
  const mobile = innerWidth < 768;
  const virtualRows = Math.ceil(visibleRows * (mobile ? 1 : 2));
  particles = samplePortrait(columns, virtualRows, mobile ? 1.65 : 1.2, visibleRows);
  particlesByRow = Array.from({ length: visibleRows }, () => []);
  for (const particle of particles) particlesByRow[particle.row].push(particle);
  baseContext.clearRect(0, 0, width, height);
  baseContext.textAlign = "center";
  baseContext.textBaseline = "middle";
  baseContext.font = `700 ${CELL_SIZE * 1.28}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  for (const particle of particles) {
    baseContext.globalAlpha = particle.alpha;
    baseContext.fillStyle = particle.ink;
    baseContext.fillText(particle.bit, particle.x, particle.y);
  }
  baseContext.globalAlpha = 1;
  draw();
}

function onPointerMove(event) {
  if (reducedMotion.matches || !finePointer.matches) return;
  const bounds = canvas.getBoundingClientRect();
  const inside = event.clientX >= bounds.left && event.clientX <= bounds.right && event.clientY >= bounds.top && event.clientY <= bounds.bottom;
  targetPointer = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  targetStrength = inside ? 1 : 0;
  if (frame === null) frame = requestAnimationFrame(animate);
}

function onPointerLeave() {
  targetStrength = 0;
  if (frame === null) frame = requestAnimationFrame(animate);
}

function startTextScramble() {
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const measurement = document.createElement("canvas").getContext("2d");
  const groups = Array.from(document.querySelectorAll("[data-scramble]"), (element) => {
    const finalText = element.textContent;
    const style = getComputedStyle(element);
    const letterSpacing = Number.parseFloat(style.letterSpacing) || 0;
    measurement.font = style.font;

    const cells = [];
    const fragment = document.createDocumentFragment();
    for (const character of finalText) {
      if (!/[a-z0-9]/i.test(character)) {
        fragment.append(document.createTextNode(character));
        continue;
      }

      const cell = document.createElement("span");
      const glyph = document.createElement("span");
      const width = measurement.measureText(character).width + letterSpacing;
      cell.className = "scramble-char";
      cell.style.width = `${Math.max(0, width)}px`;
      cell.setAttribute("aria-hidden", "true");
      glyph.className = "scramble-glyph";
      glyph.textContent = character;
      cell.append(glyph);
      fragment.append(cell);
      cells.push({ glyph, final: character, settled: false, nextChange: 0 });
    }
    element.replaceChildren(fragment);
    return cells;
  });

  const preference = matchMedia("(prefers-reduced-motion: reduce)");
  let startTime = null;
  let scrambleFrame = null;

  const showFinalText = () => {
    for (const group of groups) {
      for (const cell of group) {
        cell.glyph.textContent = cell.final;
        cell.settled = true;
      }
    }
  };

  const tick = (time) => {
    if (startTime === null) startTime = time;
    const elapsed = time - startTime;
    let active = false;

    for (const group of groups) {
      const lastLetterInterval = group.length > 1 ? 1200 / (group.length - 1) : 0;
      group.forEach((cell, index) => {
        if (cell.settled) return;
        const settleAt = 150 + index * lastLetterInterval;
        if (elapsed >= settleAt) {
          cell.glyph.textContent = cell.final;
          cell.settled = true;
        } else {
          active = true;
          if (elapsed >= cell.nextChange) {
            cell.glyph.textContent = alphabet[Math.floor(Math.random() * alphabet.length)];
            const progress = elapsed / Math.max(1, settleAt);
            cell.nextChange = elapsed + 30 * (1 + progress * progress);
          }
        }
      });
    }

    if (active) scrambleFrame = requestAnimationFrame(tick);
    else scrambleFrame = null;
  };

  if (preference.matches) {
    showFinalText();
  } else {
    scrambleFrame = requestAnimationFrame(tick);
  }

  preference.addEventListener("change", () => {
    if (!preference.matches) return;
    if (scrambleFrame !== null) cancelAnimationFrame(scrambleFrame);
    scrambleFrame = null;
    showFinalText();
  });
}

new ResizeObserver(resize).observe(canvas);
addEventListener("resize", resize);
canvas.closest(".hero").addEventListener("pointermove", onPointerMove);
canvas.closest(".hero").addEventListener("pointerleave", onPointerLeave);
image.addEventListener("load", resize);
if (image.complete) resize();
startTextScramble();
document.querySelector(".hero").classList.add("is-entered");
