'use strict';
// node scripts/make-icon.js  ->  build/icon.png (app icon) and docs/tray-states.png
const fs = require('fs');
const path = require('path');
const { encodePng } = require('../src/core/png');
const { renderTrayIcon } = require('../src/core/trayicon');

function canvas(w, h) {
  const buf = Buffer.alloc(w * h * 4);
  const rect = (x, y, rw, rh, [r, g, b, a = 255]) => {
    for (let j = Math.max(0, y); j < Math.min(h, y + rh); j++) for (let i = Math.max(0, x); i < Math.min(w, x + rw); i++) {
      const o = (j * w + i) * 4; buf[o] = r; buf[o + 1] = g; buf[o + 2] = b; buf[o + 3] = a;
    }
  };
  return { buf, rect };
}

// App icon: dark rounded tile, a pixel "j" in off-white, its dot in orange.
{
  const S = 512, { buf, rect } = canvas(S, S);
  const R = 96;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = Math.min(x, S - 1 - x), dy = Math.min(y, S - 1 - y);
    const out = dx < R && dy < R && (R - dx - 0.5) ** 2 + (R - dy - 0.5) ** 2 > R * R;
    if (!out) rect(x, y, 1, 1, [13, 13, 13]);
  }
  const cell = 44, gap = 4;
  const glyph = ['..X..', '.....', '..X..', '..X..', '..X..', 'X.X..', '.XX..'];
  const ox = Math.round((S - 5 * cell) / 2) + 6, oy = Math.round((S - 7 * cell) / 2);
  glyph.forEach((row, r) => [...row].forEach((ch, c) => {
    if (ch !== 'X') return;
    const orange = r === 0;
    rect(ox + c * cell, oy + r * cell, cell - gap, cell - gap, orange ? [255, 90, 31] : [244, 241, 234]);
  }));
  fs.writeFileSync(path.join(__dirname, '../build/icon.png'), encodePng(buf, S, S));
}

// A sheet showing the tray icon in each state, big, for the README and for checking by eye.
{
  const states = [['', 'idle'], ['45', 'later'], ['12', 'later'], ['5', 'soon'], ['1', 'soon'], ['!', 'live']];
  const cell = 128, pad = 24, W = states.length * (cell + pad) + pad, H = cell + pad * 2;
  const { buf, rect } = canvas(W, H);
  rect(0, 0, W, H, [32, 32, 32]);
  states.forEach(([text, state], i) => {
    const icon = renderTrayIcon({ text, state, size: 32 });
    const x0 = pad + i * (cell + pad);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      const o = (y * 32 + x) * 4;
      if (icon[o + 3] > 0) rect(x0 + x * 4, pad + y * 4, 4, 4, [icon[o], icon[o + 1], icon[o + 2]]);
    }
  });
  fs.mkdirSync(path.join(__dirname, '../docs'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, '../docs/tray-states.png'), encodePng(buf, W, H));
}
console.log('done');
