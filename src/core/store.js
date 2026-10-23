'use strict';
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  calendars: [],            // { id, name, url, enabled }
  leads: [10, 1],           // minutes before a meeting
  hotkey: 'Control+Alt+J',
  launchAtLogin: false,
  sound: true,
  snoozeMinutes: 1,
  manual: [],               // { id, title, startsAt, repeat, link, provider }
  perMeeting: {},           // { [meeting.key]: { leads?, mute? } }
  fired: {},                // { "key#lead": firedAtMs }, so a restart does not repeat reminders
};

/** Reads a number list the user typed, clamped to something sensible. */
function cleanLeads(list) {
  const nums = (Array.isArray(list) ? list : []).map(Number).filter((n) => Number.isFinite(n) && n >= 0 && n <= 24 * 60);
  return [...new Set(nums.map(Math.round))].sort((a, b) => b - a).slice(0, 6);
}

function merge(saved) {
  const s = { ...DEFAULTS, ...(saved && typeof saved === 'object' ? saved : {}) };
  s.calendars = (Array.isArray(s.calendars) ? s.calendars : []).filter((c) => c && typeof c.url === 'string');
  s.leads = cleanLeads(s.leads);
  if (!s.leads.length && !(saved && Array.isArray(saved.leads))) s.leads = [...DEFAULTS.leads];
  s.manual = Array.isArray(s.manual) ? s.manual : [];
  s.perMeeting = s.perMeeting && typeof s.perMeeting === 'object' ? s.perMeeting : {};
  s.fired = s.fired && typeof s.fired === 'object' ? s.fired : {};
  return s;
}

class Store {
  constructor(file) { this.file = file; this.data = merge(this._read()); }
  _read() { try { return JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { return null; } }
  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);                      // never leaves a half-written settings file
  }
  patch(p) { this.data = merge({ ...this.data, ...p }); this.save(); return this.data; }
  /** Forget fired markers older than two days. */
  pruneFired(now) {
    for (const [k, t] of Object.entries(this.data.fired)) if (now - t > 2 * 86400e3) delete this.data.fired[k];
  }
}

module.exports = { Store, DEFAULTS, merge, cleanLeads };
