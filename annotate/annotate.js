import { getShot, updateShot } from '../lib/db.js';

const params = new URLSearchParams(location.search);
const shotId = Number(params.get('shot'));

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const textInput = document.getElementById('text-input');
const hint = document.getElementById('hint');

let image = null; // HTMLImageElement of the base screenshot
let shapes = []; // committed annotations
let redoStack = [];
let tool = 'rect';
let color = '#ff2d55';
let width = 4;
let drawing = null; // shape in progress
let markerCount = 0;
let scale = 1; // css px per canvas px (canvas is drawn at natural size)
let cropRect = null; // pending crop selection

const SWATCHES = ['#ff2d55', '#ff9500', '#ffcc00', '#34c759', '#007aff', '#af52de', '#000000', '#ffffff'];

function setTool(t) {
  tool = t;
  document.querySelectorAll('.tool').forEach((b) => b.classList.toggle('tool--active', b.dataset.tool === t));
  hint.textContent = {
    rect: 'Drag to draw a rectangle.',
    ellipse: 'Drag to draw an ellipse.',
    arrow: 'Drag from the tail to the head of the arrow.',
    pen: 'Drag to draw freehand.',
    highlight: 'Drag to highlight an area.',
    text: 'Click where the text should start, type, then press Enter.',
    number: 'Click to drop a numbered marker.',
    blur: 'Drag over anything sensitive to pixelate it.',
    crop: 'Drag to select the area to keep, then press Enter (Esc cancels).',
  }[t];
  canvas.style.cursor = t === 'text' ? 'text' : 'crosshair';
}

function setColor(c) {
  color = c;
  document.getElementById('color').value = c;
  document.querySelectorAll('.swatch').forEach((s) => s.classList.toggle('swatch--active', s.dataset.color === c));
}

function canvasPoint(evt) {
  const r = canvas.getBoundingClientRect();
  return { x: (evt.clientX - r.left) * (canvas.width / r.width), y: (evt.clientY - r.top) * (canvas.height / r.height) };
}

function fitCanvas() {
  const stage = document.getElementById('stage');
  const maxW = stage.clientWidth - 24;
  const maxH = stage.clientHeight - 24;
  scale = Math.min(1, maxW / canvas.width, maxH / canvas.height);
  canvas.style.width = `${Math.floor(canvas.width * scale)}px`;
  canvas.style.height = `${Math.floor(canvas.height * scale)}px`;
}

// --- rendering ---------------------------------------------------------------
function drawShape(s) {
  ctx.save();
  ctx.lineWidth = s.width;
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  switch (s.type) {
    case 'rect': {
      ctx.strokeRect(s.x, s.y, s.w, s.h);
      break;
    }
    case 'ellipse': {
      ctx.beginPath();
      ctx.ellipse(s.x + s.w / 2, s.y + s.h / 2, Math.abs(s.w / 2), Math.abs(s.h / 2), 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 'arrow': {
      const head = Math.max(12, s.width * 4);
      const ang = Math.atan2(s.y2 - s.y, s.x2 - s.x);
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x2, s.y2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(s.x2, s.y2);
      ctx.lineTo(s.x2 - head * Math.cos(ang - Math.PI / 6), s.y2 - head * Math.sin(ang - Math.PI / 6));
      ctx.lineTo(s.x2 - head * Math.cos(ang + Math.PI / 6), s.y2 - head * Math.sin(ang + Math.PI / 6));
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'pen': {
      if (s.points.length < 2) break;
      ctx.beginPath();
      ctx.moveTo(s.points[0].x, s.points[0].y);
      for (const p of s.points.slice(1)) ctx.lineTo(p.x, p.y);
      ctx.stroke();
      break;
    }
    case 'highlight': {
      ctx.globalAlpha = 0.35;
      ctx.fillRect(s.x, s.y, s.w, s.h);
      break;
    }
    case 'text': {
      const size = 14 + s.width * 2;
      ctx.font = `600 ${size}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
      ctx.textBaseline = 'top';
      const lines = s.text.split('\n');
      const pad = 4;
      const w = Math.max(...lines.map((l) => ctx.measureText(l).width));
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(s.x - pad, s.y - pad, w + pad * 2, lines.length * size * 1.25 + pad * 2);
      ctx.globalAlpha = 1;
      ctx.fillStyle = s.color;
      lines.forEach((l, i) => ctx.fillText(l, s.x, s.y + i * size * 1.25));
      break;
    }
    case 'number': {
      const r = 12 + s.width;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = `700 ${r + 2}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(s.n), s.x, s.y + 1);
      break;
    }
    case 'blur': {
      const x = Math.max(0, Math.min(s.x, s.x + s.w));
      const y = Math.max(0, Math.min(s.y, s.y + s.h));
      const w = Math.min(canvas.width - x, Math.abs(s.w));
      const h = Math.min(canvas.height - y, Math.abs(s.h));
      if (w < 2 || h < 2) break;
      // Pixelate: downscale the region then upscale it without smoothing.
      const block = 12;
      const tmp = document.createElement('canvas');
      tmp.width = Math.max(1, Math.ceil(w / block));
      tmp.height = Math.max(1, Math.ceil(h / block));
      const tctx = tmp.getContext('2d');
      tctx.imageSmoothingEnabled = true;
      tctx.drawImage(canvas, x, y, w, h, 0, 0, tmp.width, tmp.height);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(tmp, 0, 0, tmp.width, tmp.height, x, y, w, h);
      ctx.imageSmoothingEnabled = true;
      break;
    }
    default:
      break;
  }
  ctx.restore();
}

function normalize(s) {
  if ('w' in s && s.w < 0) {
    s.x += s.w;
    s.w = -s.w;
  }
  if ('h' in s && s.h < 0) {
    s.y += s.h;
    s.h = -s.h;
  }
  return s;
}

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0);
  for (const s of shapes) drawShape(s);
  if (drawing) drawShape(drawing);
  if (cropRect) {
    const c = normalize({ ...cropRect });
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,.5)';
    ctx.beginPath();
    ctx.rect(0, 0, canvas.width, canvas.height);
    ctx.rect(c.x, c.y, c.w, c.h);
    ctx.fill('evenodd');
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.strokeRect(c.x, c.y, c.w, c.h);
    ctx.restore();
  }
  document.getElementById('undo').disabled = !shapes.length;
  document.getElementById('redo').disabled = !redoStack.length;
}

// --- input ---------------------------------------------------------------------
canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  if (!textInput.hidden) commitText();
  const p = canvasPoint(e);
  if (tool === 'text') {
    // Stop the default mousedown focus change from blurring the input we are
    // about to focus.
    e.preventDefault();
    placeTextInput(p);
    return;
  }
  canvas.setPointerCapture(e.pointerId);
  if (tool === 'number') {
    markerCount += 1;
    push({ type: 'number', x: p.x, y: p.y, n: markerCount, color, width });
    render();
    return;
  }
  if (tool === 'crop') {
    cropRect = { x: p.x, y: p.y, w: 0, h: 0 };
    drawing = null;
    render();
    return;
  }
  if (tool === 'pen') drawing = { type: 'pen', points: [p], color, width };
  else if (tool === 'arrow') drawing = { type: 'arrow', x: p.x, y: p.y, x2: p.x, y2: p.y, color, width };
  else drawing = { type: tool, x: p.x, y: p.y, w: 0, h: 0, color, width };
});

canvas.addEventListener('pointermove', (e) => {
  const p = canvasPoint(e);
  if (tool === 'crop' && cropRect && e.buttons) {
    cropRect.w = p.x - cropRect.x;
    cropRect.h = p.y - cropRect.y;
    render();
    return;
  }
  if (!drawing) return;
  if (drawing.type === 'pen') drawing.points.push(p);
  else if (drawing.type === 'arrow') {
    drawing.x2 = p.x;
    drawing.y2 = p.y;
  } else {
    drawing.w = p.x - drawing.x;
    drawing.h = p.y - drawing.y;
  }
  render();
});

canvas.addEventListener('pointerup', () => {
  if (tool === 'crop') {
    if (cropRect && (Math.abs(cropRect.w) < 4 || Math.abs(cropRect.h) < 4)) cropRect = null;
    render();
    return;
  }
  if (!drawing) return;
  const s = drawing;
  drawing = null;
  const tooSmall = ('w' in s && Math.abs(s.w) < 3 && Math.abs(s.h) < 3) || (s.type === 'arrow' && Math.hypot(s.x2 - s.x, s.y2 - s.y) < 3) || (s.type === 'pen' && s.points.length < 2);
  if (!tooSmall) push(normalize(s));
  render();
});

function push(s) {
  shapes.push(s);
  redoStack = [];
}

function placeTextInput(p) {
  const r = canvas.getBoundingClientRect();
  const stage = document.getElementById('stage');
  textInput.style.left = `${r.left - stage.getBoundingClientRect().left + stage.scrollLeft + p.x * scale}px`;
  textInput.style.top = `${r.top - stage.getBoundingClientRect().top + stage.scrollTop + p.y * scale}px`;
  textInput.style.color = color;
  textInput.style.fontSize = `${(14 + width * 2) * scale}px`;
  textInput.value = '';
  textInput.dataset.x = p.x;
  textInput.dataset.y = p.y;
  textInput.hidden = false;
  textInput.focus();
  // Safety net: some pointer implementations still move focus after this handler.
  requestAnimationFrame(() => {
    if (!textInput.hidden && document.activeElement !== textInput) textInput.focus();
  });
}

function commitText() {
  const text = textInput.value.trim();
  if (text) push({ type: 'text', x: Number(textInput.dataset.x), y: Number(textInput.dataset.y), text, color, width });
  textInput.hidden = true;
  textInput.value = '';
  render();
}

textInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    commitText();
  }
  if (e.key === 'Escape') {
    textInput.hidden = true;
    textInput.value = '';
  }
});
textInput.addEventListener('blur', () => {
  if (!textInput.hidden) commitText();
});

function applyCrop() {
  if (!cropRect) return;
  const c = normalize({ ...cropRect });
  c.x = Math.max(0, Math.round(c.x));
  c.y = Math.max(0, Math.round(c.y));
  c.w = Math.min(canvas.width - c.x, Math.round(c.w));
  c.h = Math.min(canvas.height - c.y, Math.round(c.h));
  cropRect = null;
  if (c.w < 4 || c.h < 4) return render();
  // Bake existing annotations into the new base image so crop is a clean cut.
  render();
  const off = document.createElement('canvas');
  off.width = c.w;
  off.height = c.h;
  off.getContext('2d').drawImage(canvas, c.x, c.y, c.w, c.h, 0, 0, c.w, c.h);
  const img = new Image();
  img.onload = () => {
    image = img;
    shapes = [];
    redoStack = [];
    canvas.width = c.w;
    canvas.height = c.h;
    fitCanvas();
    render();
  };
  img.src = off.toDataURL('image/png');
}

function undo() {
  if (!shapes.length) return;
  const s = shapes.pop();
  redoStack.push(s);
  if (s.type === 'number') markerCount = Math.max(0, markerCount - 1);
  render();
}
function redo() {
  if (!redoStack.length) return;
  const s = redoStack.pop();
  shapes.push(s);
  if (s.type === 'number') markerCount += 1;
  render();
}

async function save() {
  if (!textInput.hidden) commitText();
  cropRect = null;
  drawing = null;
  render();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  await updateShot(shotId, { blob, annotated: shapes.length > 0 || image.width !== originalSize.w || image.height !== originalSize.h });
  try {
    await chrome.runtime.sendMessage({ type: 'shot-updated', id: shotId });
  } catch {
    // Side panel may be closed; nothing to notify.
  }
  window.close();
}

document.getElementById('tools').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tool]');
  if (b) setTool(b.dataset.tool);
});
document.getElementById('color').addEventListener('input', (e) => setColor(e.target.value));
document.getElementById('width').addEventListener('input', (e) => (width = Number(e.target.value)));
document.getElementById('undo').addEventListener('click', undo);
document.getElementById('redo').addEventListener('click', redo);
document.getElementById('clear').addEventListener('click', () => {
  shapes = [];
  redoStack = [];
  markerCount = 0;
  render();
});
document.getElementById('cancel').addEventListener('click', () => window.close());
document.getElementById('save').addEventListener('click', save);

const sw = document.getElementById('swatches');
for (const c of SWATCHES) {
  const s = document.createElement('span');
  s.className = 'swatch';
  s.dataset.color = c;
  s.style.background = c;
  s.addEventListener('click', () => setColor(c));
  sw.appendChild(s);
}

document.addEventListener('keydown', (e) => {
  if (!textInput.hidden) return;
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    return e.shiftKey ? redo() : undo();
  }
  if (mod && e.key.toLowerCase() === 's') {
    e.preventDefault();
    return save();
  }
  if (e.key === 'Escape') {
    if (cropRect) cropRect = null;
    drawing = null;
    return render();
  }
  if (e.key === 'Enter' && tool === 'crop' && cropRect) return applyCrop();
  const map = { r: 'rect', e: 'ellipse', a: 'arrow', p: 'pen', h: 'highlight', t: 'text', n: 'number', b: 'blur', c: 'crop' };
  if (!mod && map[e.key.toLowerCase()]) setTool(map[e.key.toLowerCase()]);
});

window.addEventListener('resize', () => {
  if (image) fitCanvas();
});

let originalSize = { w: 0, h: 0 };
async function init() {
  const shot = await getShot(shotId);
  if (!shot) {
    hint.textContent = 'This screenshot no longer exists.';
    document.getElementById('save').disabled = true;
    return;
  }
  const url = URL.createObjectURL(shot.blob);
  image = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
  URL.revokeObjectURL(url);
  originalSize = { w: image.width, h: image.height };
  canvas.width = image.width;
  canvas.height = image.height;
  fitCanvas();
  setTool('rect');
  setColor(color);
  render();
}
init().catch((err) => {
  hint.textContent = `Could not load screenshot: ${err.message}`;
});
