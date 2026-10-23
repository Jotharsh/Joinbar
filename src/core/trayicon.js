'use strict';
// Windows tray icons cannot show text next to them, so the minutes left are drawn inside the icon.

const DIGITS = {
  '0': ['111', '101', '101', '101', '111'], '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'], '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'], '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'], '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'], '9': ['111', '101', '111', '001', '111'],
};
const COLORS = {
  idle: [138, 135, 127], later: [244, 241, 234], soon: [255, 90, 31], live: [52, 199, 89],
};

/** Which colour to use for the number. */
function stateFor(minutes, live) {
  if (live) return 'live';
  if (minutes == null) return 'idle';
  return minutes <= 5 ? 'soon' : 'later';
}

/**
 * Draws a size x size RGBA icon: a dark rounded square with the number in it.
 * `text` is "" (nothing coming up: just a dot), digits (up to 2) or "!" for live.
 */
function renderTrayIcon({ text = '', state = 'idle', size = 16 }) {
  const buf = Buffer.alloc(size * size * 4);
  const put = (x, y, [r, g, b], a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = a;
  };
  // background: rounded square
  const radius = Math.max(2, Math.round(size / 5));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = Math.min(x, size - 1 - x), dy = Math.min(y, size - 1 - y);
    const inCorner = dx < radius && dy < radius && (radius - dx - 0.5) ** 2 + (radius - dy - 0.5) ** 2 > radius ** 2;
    if (!inCorner) put(x, y, [13, 13, 13]);
  }
  const color = COLORS[state] || COLORS.later;
  const scale = Math.max(1, Math.floor(size / 8));       // 16 -> 2, 32 -> 4
  const chars = [...String(text)].slice(0, 2);

  if (!chars.length) {                                   // nothing coming up: a small square dot
    const d = scale * 2, o = Math.floor((size - d) / 2);
    for (let y = 0; y < d; y++) for (let x = 0; x < d; x++) put(o + x, o + y, color);
    return buf;
  }
  const glyphW = 3 * scale, gap = scale;
  const totalW = chars.length * glyphW + (chars.length - 1) * gap, totalH = 5 * scale;
  const x0 = Math.floor((size - totalW) / 2), y0 = Math.floor((size - totalH) / 2);
  chars.forEach((ch, i) => {
    const rows = ch === '!' ? ['010', '010', '010', '000', '010'] : DIGITS[ch];
    if (!rows) return;
    rows.forEach((row, ry) => [...row].forEach((bit, rx) => {
      if (bit !== '1') return;
      for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) {
        put(x0 + i * (glyphW + gap) + rx * scale + sx, y0 + ry * scale + sy, color);
      }
    }));
  });
  return buf;
}

module.exports = { renderTrayIcon, stateFor };
