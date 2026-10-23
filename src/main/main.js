'use strict';
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, nativeImage, screen, shell } = require('electron');

if (process.env.JOINBAR_USERDATA) app.setPath('userData', process.env.JOINBAR_USERDATA);

const { Store, cleanLeads } = require('../core/store');
const { parseCalendar } = require('../core/calendar');
const S = require('../core/schedule');
const { describeLink, safeUrl } = require('../core/links');
const { renderTrayIcon, stateFor } = require('../core/trayicon');
const { encodePng } = require('../core/png');

const SELFTEST = process.argv.includes('--selftest');
const opened = [];
const openLink = (url) => (SELFTEST ? opened.push(url) : shell.openExternal(url));
let DEMO = process.argv.includes('--selftest') || process.argv.includes('--demo') || process.argv.includes('--screenshots');
const SHOTS_DIR = (() => { const i = process.argv.indexOf('--screenshots'); return i > -1 ? process.argv[i + 1] : null; })();
const DAY = 86400e3;

let store, tray, popup, toast;
let meetings = [];                 // everything in the next week, calendars and my own reminders together
const status = {};                 // calendar id -> { ok, error, at }
const snoozed = [];                // { meeting, lead, at }
const toastQueue = [];
let toastShowing = null;
let hotkeyError = '';
let popupHiddenAt = 0;       // on Windows a tray click first blurs (hides) the popup; without this it would flash back open

// ---------------------------------------------------------------- calendars

const cacheFile = (id) => path.join(app.getPath('userData'), 'cache', `${id}.ics`);
const startOfDay = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };

async function fetchIcs(rawUrl) {
  let url = rawUrl.trim().replace(/^webcals?:\/\//i, 'https://');
  if (!safeUrl(url)) throw new Error('That does not look like a web link.');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20000);
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: { accept: 'text/calendar, text/plain, */*' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 15 * 1024 * 1024) throw new Error('The calendar file is too big.');
    const text = buf.toString('utf8');
    if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('NOT_CALENDAR');
    return text;
  } finally { clearTimeout(timer); }
}

function friendly(e) {
  const m = String(e && e.message || e);
  if (/HTTP (401|403|404|410)/.test(m)) return 'This link no longer works. Copy a fresh one from your calendar settings.';
  if (m === 'NOT_CALENDAR') return 'That link is not a calendar. Use the "secret address in iCal format" link.';
  if (/abort|fetch failed|ENOTFOUND|ECONN|network/i.test(m)) return "Couldn't reach the calendar (offline?). Showing the last copy.";
  return m;
}

async function syncOne(c) {
  try {
    const text = await fetchIcs(c.url);
    fs.mkdirSync(path.dirname(cacheFile(c.id)), { recursive: true });
    fs.writeFileSync(cacheFile(c.id), text);
    status[c.id] = { ok: true, at: Date.now() };
  } catch (e) {
    status[c.id] = { ok: false, error: friendly(e), at: Date.now() };
  }
}

async function syncAll() {
  if (!DEMO) await Promise.all(store.data.calendars.filter((c) => c.enabled !== false).map(syncOne));
  rebuild();
}

/** Re-reads the saved copies, so the app also works offline and starts instantly. */
function rebuild() {
  const now = Date.now();
  const window = { from: startOfDay(now) - 2 * 3600e3, to: now + 8 * DAY };
  const all = [];
  for (const c of store.data.calendars) {
    if (c.enabled === false) continue;
    try {
      const text = fs.readFileSync(cacheFile(c.id), 'utf8');
      all.push(...parseCalendar(text, { ...window, calendarId: c.id, calendarName: c.name }));
      status[c.id] = { ...(status[c.id] || { ok: true }), parsed: true };
    } catch (e) {
      if (e.code !== 'ENOENT') status[c.id] = { ...(status[c.id] || {}), ok: false, error: 'Could not read this calendar file.' };
    }
  }
  all.push(...S.expandManual(store.data.manual, window));
  meetings = all.sort((a, b) => a.start - b.start);
  tick();
  broadcast();
}

// ---------------------------------------------------------------- state for the windows

function snapshot() {
  const now = Date.now();
  const focus = S.pickFocus(meetings.filter((m) => m.end > now), now);
  const view = (m) => m && ({ ...m, when: S.describeWhen(m, now), mute: !!(store.data.perMeeting[m.key] || {}).mute,
    leads: (store.data.perMeeting[m.key] || {}).leads || null });
  return {
    now,
    focus: { state: focus.state, meeting: view(focus.meeting) },
    meetings: meetings.filter((m) => m.end > startOfDay(now) && m.start < startOfDay(now) + 7 * DAY).map(view),
    settings: {
      leads: store.data.leads, hotkey: store.data.hotkey, hotkeyError, launchAtLogin: store.data.launchAtLogin,
      sound: store.data.sound, snoozeMinutes: store.data.snoozeMinutes,
      calendars: store.data.calendars.map((c) => ({ id: c.id, name: c.name, enabled: c.enabled !== false, status: status[c.id] || null })),
      manual: store.data.manual.map((r) => ({ ...r })),
    },
    version: app.getVersion(),
  };
}

function broadcast() {
  if (popup && !popup.isDestroyed()) popup.webContents.send('jb:state', snapshot());
}

// ---------------------------------------------------------------- tray

let lastIconKey = '';
function iconImage(text, state) {
  const img = nativeImage.createFromBuffer(encodePng(renderTrayIcon({ text, state, size: 16 }), 16), { scaleFactor: 1 });
  img.addRepresentation({ scaleFactor: 2, buffer: encodePng(renderTrayIcon({ text, state, size: 32 }), 32) });
  return img;
}

function updateTray(now = Date.now()) {
  if (!tray) return;
  const { meeting, state } = S.pickFocus(meetings.filter((m) => m.end > now), now);
  let text = '', st = 'idle', tip = 'Joinbar: nothing coming up';
  if (meeting && state === 'live') { text = '!'; st = 'live'; tip = `${meeting.title}: ${S.describeWhen(meeting, now)}`; }
  else if (meeting) {
    const mins = S.minutesUntil(meeting.start, now);
    st = stateFor(mins, false);
    text = mins < 100 ? String(mins) : '';
    tip = `${meeting.title}: ${S.describeWhen(meeting, now)}`;
  }
  const key = `${text}|${st}`;
  if (key !== lastIconKey) { tray.setImage(iconImage(text, st)); lastIconKey = key; }
  tray.setToolTip(tip);
}

function trayMenu() {
  const now = Date.now();
  const j = S.pickJoinable(meetings, now);
  return Menu.buildFromTemplate([
    ...(j ? [{ label: `Join "${j.title.slice(0, 40)}"${j.provider ? ` (${j.provider})` : ''}`, click: () => joinMeeting(j) }, { type: 'separator' }] : []),
    { label: 'Open Joinbar', click: () => showPopup() },
    { label: 'Refresh calendars', click: () => syncAll() },
    { type: 'separator' },
    { label: 'Start with Windows', type: 'checkbox', checked: !!store.data.launchAtLogin, click: (i) => setSetting('launchAtLogin', i.checked) },
    { label: 'Quit Joinbar', click: () => app.quit() },
  ]);
}

// ---------------------------------------------------------------- windows

const webPrefs = (extra = {}) => ({ preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, ...extra });

function createPopup() {
  popup = new BrowserWindow({
    width: 400, height: 620, show: false, frame: false, resizable: false, skipTaskbar: true, alwaysOnTop: true,
    backgroundColor: '#0d0d0d', title: 'Joinbar', fullscreenable: false, webPreferences: webPrefs(),
  });
  popup.loadFile(path.join(__dirname, '../renderer/popup.html'));
  popup.on('blur', () => { if (!DEMO && popup.isVisible()) { popup.hide(); popupHiddenAt = Date.now(); } });
  popup.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  popup.webContents.on('will-navigate', (e) => e.preventDefault());
}

function placePopup() {
  const b = tray && tray.getBounds();
  const [w, h] = popup.getSize();
  const anchor = b && b.width ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : screen.getCursorScreenPoint();
  const wa = screen.getDisplayNearestPoint(anchor).workArea;
  let x = Math.round(anchor.x - w / 2), y = anchor.y > wa.y + wa.height / 2 ? Math.round(anchor.y - h - 12) : Math.round(anchor.y + 16);
  x = Math.min(Math.max(x, wa.x + 8), wa.x + wa.width - w - 8);
  y = Math.min(Math.max(y, wa.y + 8), wa.y + wa.height - h - 8);
  popup.setPosition(x, y, false);
}

function showPopup(tab) {
  if (!popup || popup.isDestroyed()) createPopup();
  placePopup();
  broadcast();
  popup.show(); popup.focus();
  if (tab) popup.webContents.send('jb:tab', tab);
}

function togglePopup() {
  if (popup && popup.isVisible()) popup.hide();
  else if (Date.now() - popupHiddenAt > 250) showPopup();
}

// ---- reminder pop-ups (toasts)

function queueToast(item) {
  if (toastQueue.some((q) => q.meeting.key === item.meeting.key) || (toastShowing && toastShowing.meeting.key === item.meeting.key)) return;
  toastQueue.push(item);
  showNextToast();
}

function showNextToast() {
  if (toastShowing || !toastQueue.length) return;
  toastShowing = toastQueue.shift();
  const wa = screen.getPrimaryDisplay().workArea;
  const w = 380, h = 170;
  toast = new BrowserWindow({
    width: w, height: h, x: wa.x + wa.width - w - 16, y: wa.y + wa.height - h - 16,
    show: false, frame: false, resizable: false, skipTaskbar: true, alwaysOnTop: true, focusable: true,
    backgroundColor: '#161616', transparent: false, webPreferences: webPrefs(),
  });
  toast.setAlwaysOnTop(true, 'screen-saver');
  toast.loadFile(path.join(__dirname, '../renderer/toast.html'));
  toast.webContents.once('did-finish-load', () => { if (toast && !toast.isDestroyed()) { toast.showInactive(); if (store.data.sound && !DEMO) shell.beep(); } });
  toast.on('closed', () => { toast = null; toastShowing = null; setTimeout(showNextToast, 400); });
}

function closeToast() { if (toast && !toast.isDestroyed()) toast.close(); }

// ---------------------------------------------------------------- actions

function joinMeeting(m) {
  const url = m && safeUrl(m.link);
  if (!url) return false;
  openLink(url);
  return true;
}

const findMeeting = (key) => meetings.find((m) => m.key === key);

function setSetting(key, value) {
  if (key === 'sound' || key === 'launchAtLogin') {
    store.patch({ [key]: !!value });
    if (key === 'launchAtLogin' && app.isPackaged) app.setLoginItemSettings({ openAtLogin: !!value });
  } else if (key === 'snoozeMinutes') {
    store.patch({ snoozeMinutes: [1, 2, 5, 10].includes(Number(value)) ? Number(value) : 1 });
  } else if (key === 'leads') {
    store.patch({ leads: value });
  } else if (key === 'hotkey') {
    return registerHotkey(String(value));
  }
  tick(); broadcast();
  return { ok: true };
}

function registerHotkey(accelerator) {
  const previous = store.data.hotkey;
  try { globalShortcut.unregisterAll(); } catch { /* nothing registered */ }
  let ok = false;
  try { ok = globalShortcut.register(accelerator, onHotkey); } catch { ok = false; }
  if (ok) { hotkeyError = ''; if (accelerator !== previous) store.patch({ hotkey: accelerator }); return { ok: true }; }
  hotkeyError = `${accelerator} is already used by another app. Pick a different one.`;
  try { if (previous && previous !== accelerator) globalShortcut.register(previous, onHotkey); } catch { /* ignore */ }
  broadcast();
  return { ok: false, error: hotkeyError };
}

function onHotkey() {
  const m = S.pickJoinable(meetings, Date.now());
  if (m) joinMeeting(m); else showPopup('meetings');
}

const newId = () => Math.random().toString(36).slice(2, 10);

function handleAction(a) {
  switch (a && a.type) {
    case 'join': { const m = findMeeting(a.key); return { ok: joinMeeting(m) }; }
    case 'refresh': syncAll(); return { ok: true };
    case 'addCalendar': {
      const url = String(a.url || '').trim().replace(/^webcals?:\/\//i, 'https://');
      if (!safeUrl(url)) return { ok: false, error: 'Paste the calendar link (it starts with https:// or webcal://).' };
      const c = { id: newId(), name: String(a.name || '').trim().slice(0, 40) || 'Calendar', url, enabled: true };
      store.patch({ calendars: [...store.data.calendars, c] });
      syncOne(c).then(() => { rebuild(); });
      return { ok: true };
    }
    case 'removeCalendar': store.patch({ calendars: store.data.calendars.filter((c) => c.id !== a.id) }); try { fs.unlinkSync(cacheFile(a.id)); } catch { /* none */ } rebuild(); return { ok: true };
    case 'toggleCalendar': store.patch({ calendars: store.data.calendars.map((c) => c.id === a.id ? { ...c, enabled: c.enabled === false } : c) }); rebuild(); return { ok: true };
    case 'setting': return setSetting(a.key, a.value);
    case 'meetingReminder': {
      const m = findMeeting(a.key);
      if (!m) return { ok: false };
      const per = { ...store.data.perMeeting };
      const next = { ...(per[a.key] || {}) };
      if ('mute' in a) next.mute = !!a.mute;
      if ('leads' in a) { if (a.leads === null) delete next.leads; else next.leads = cleanLeads(a.leads); }
      if (!next.mute && !next.leads) delete per[a.key]; else per[a.key] = next;
      // Lead times that have already passed must not fire the moment they are added.
      const now = Date.now();
      for (const lead of next.leads || []) if (m.start - lead * S.MIN <= now) store.data.fired[`${a.key}#${lead}`] = now;
      store.patch({ perMeeting: per });
      rebuild(); return { ok: true };
    }
    case 'addManual': {
      const title = String(a.title || '').trim().slice(0, 80);
      const startsAt = Number(a.startsAt);
      if (!title) return { ok: false, error: 'Give the reminder a name.' };
      if (!Number.isFinite(startsAt)) return { ok: false, error: 'Pick a date and time.' };
      let link = null, provider = null;
      if (a.link && String(a.link).trim()) {
        const d = describeLink(String(a.link).trim());
        if (!d) return { ok: false, error: 'The link must start with https://' };
        link = d.url; provider = d.provider;
      }
      const repeat = ['once', 'daily', 'weekdays', 'weekly'].includes(a.repeat) ? a.repeat : 'once';
      const lead = [0, 1, 2, 5, 10, 15].includes(Number(a.lead)) ? Number(a.lead) : 5;
      store.patch({ manual: [...store.data.manual, { id: newId(), title, startsAt, repeat, lead, link, provider }] });
      rebuild(); return { ok: true };
    }
    case 'removeManual': store.patch({ manual: store.data.manual.filter((r) => r.id !== a.id) }); rebuild(); return { ok: true };
    case 'testReminder': {
      const now = Date.now();
      queueToast({ meeting: { key: `test|${now}`, title: 'Test reminder', start: now + 5 * 60e3, end: now + 35 * 60e3, link: 'https://example.com/', provider: 'Test' }, lead: 5 });
      return { ok: true };
    }
    case 'quit': app.quit(); return { ok: true };
    default: return { ok: false };
  }
}

// ---------------------------------------------------------------- reminders

function tick() {
  const now = Date.now();
  const { show, mark } = S.dueReminders(meetings, { leads: store.data.leads, perMeeting: store.data.perMeeting, fired: new Set(Object.keys(store.data.fired)), now });
  if (mark.length) { for (const k of mark) store.data.fired[k] = now; store.pruneFired(now); store.save(); }
  for (const s of show) queueToast(s);
  for (let i = snoozed.length - 1; i >= 0; i--) if (snoozed[i].at <= now) { const [s] = snoozed.splice(i, 1); if (s.meeting.end > now) queueToast({ meeting: s.meeting, lead: s.lead }); }
  updateTray(now);
}

// ---------------------------------------------------------------- IPC

function senderIs(e, win) { return win && !win.isDestroyed() && e.sender === win.webContents; }

ipcMain.handle('jb:state', (e) => (senderIs(e, popup) ? snapshot() : null));
ipcMain.handle('jb:do', (e, a) => (senderIs(e, popup) ? handleAction(a) : { ok: false }));
ipcMain.handle('jb:toast', (e) => (senderIs(e, toast) && toastShowing ? { meeting: toastShowing.meeting, lead: toastShowing.lead, snoozeMinutes: store.data.snoozeMinutes } : null));
ipcMain.handle('jb:toastAction', (e, action) => {
  if (!senderIs(e, toast) || !toastShowing) return { ok: false };
  const t = toastShowing;
  if (action === 'join') joinMeeting(t.meeting);
  if (action === 'snooze') snoozed.push({ meeting: t.meeting, lead: t.lead, at: Date.now() + store.data.snoozeMinutes * 60e3 });
  closeToast();
  return { ok: true };
});

// ---------------------------------------------------------------- start

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => showPopup());
  app.on('web-contents-created', (_e, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));      // no window may open another window
    contents.on('will-navigate', (ev) => ev.preventDefault());       // or go anywhere else
  });
  app.on('window-all-closed', () => { /* a tray app keeps running */ });
  app.whenReady().then(async () => {
    if (process.platform === 'win32') app.setAppUserModelId('io.github.jotharsh.joinbar');
    if (process.platform === 'darwin' && app.dock) app.dock.hide();
    store = new Store(path.join(app.getPath('userData'), 'settings.json'));
    if (DEMO) require('./demo').install(store, cacheFile);

    tray = new Tray(iconImage('', 'idle'));
    tray.on('click', togglePopup);
    tray.on('right-click', () => tray.popUpContextMenu(trayMenu()));
    createPopup();
    registerHotkey(store.data.hotkey);
    await syncAll();
    setInterval(tick, 15000);
    setInterval(() => { if (!DEMO) syncAll(); }, 5 * 60e3);
    if (!store.data.calendars.length && !store.data.manual.length) showPopup('settings');
    if (SELFTEST) { await require('./selftest').run({ handleAction, snapshot, onHotkey, meetings: () => meetings, opened, store, toastQueue, toastShowing: () => toastShowing, lastIcon: () => lastIconKey, tick, registerHotkey, snoozed, closeToast, app, setDemo: (v) => { DEMO = v; } }); return; }
    if (SHOTS_DIR) require('./demo').shoot({ SHOTS_DIR, showPopup, popup: () => popup, queueToast, meetings: () => meetings, toast: () => toast, app });
  });
  app.on('will-quit', () => globalShortcut.unregisterAll());
}
