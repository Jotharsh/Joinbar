'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fx = require('./fixtures');
const { parseCalendar } = require('../src/core/calendar');
const { findMeetingLink, safeUrl, describeLink } = require('../src/core/links');
const S = require('../src/core/schedule');
const { renderTrayIcon, stateFor } = require('../src/core/trayicon');
const { merge, cleanLeads, Store } = require('../src/core/store');

const D = (iso) => Date.parse(iso);
const day = { from: D('2026-10-23T00:00:00Z'), to: D('2026-10-23T23:59:59Z') };

test('a simple event is read, with its Zoom link pulled out of the description', () => {
  const [m] = parseCalendar(fx.simple, day);
  assert.equal(m.title, 'Design review');
  assert.equal(m.start, D('2026-10-23T09:00:00Z'));
  assert.equal(m.end, D('2026-10-23T09:30:00Z'));
  assert.equal(m.provider, 'Zoom');
  assert.equal(m.link, 'https://acme.zoom.us/j/123456789?pwd=abc');
});

test('events outside the window are left out', () => {
  assert.equal(parseCalendar(fx.simple, { from: D('2026-10-24T00:00:00Z'), to: D('2026-10-25T00:00:00Z') }).length, 0);
});

test('a repeating event expands, skips an EXDATE and applies a moved occurrence', () => {
  const week = { from: D('2026-10-19T00:00:00Z'), to: D('2026-10-25T23:59:59Z') };
  const ms = parseCalendar(fx.weekly, week);
  const starts = ms.map((m) => new Date(m.start).toISOString());
  assert.deepEqual(starts, ['2026-10-19T10:00:00.000Z', '2026-10-23T12:00:00.000Z'],
    'Monday stays, Wednesday is excluded, Friday moved from 10:00 to 12:00');
  assert.equal(ms[1].title, 'Standup (moved)');
  assert.equal(ms[0].provider, 'Google Meet');
  assert.notEqual(ms[0].key, ms[1].key);
});

test('cancelled and all-day events are dropped, events with no link keep link = null', () => {
  const ms = parseCalendar(fx.cancelledAndAllDay, day);
  assert.deepEqual(ms.map((m) => m.title), ['Coffee with Sam']);
  assert.equal(ms[0].link, null);
});

test('a time zone inside the file is honoured (09:00 in New York, daylight time, is 13:00 UTC)', () => {
  const [m] = parseCalendar(fx.zoned, day);
  assert.equal(new Date(m.start).toISOString(), '2026-10-23T13:00:00.000Z');
});

test('a broken calendar throws, instead of silently returning nothing', () => {
  assert.throws(() => parseCalendar('this is not a calendar', day));
});

test('link finder knows the main services and ignores look-alikes', () => {
  const cases = [
    ['Join: https://us02web.zoom.us/j/8123456789?pwd=Xy.', 'Zoom'],
    ['https://meet.google.com/abc-defg-hij', 'Google Meet'],
    ['<https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc/0?context=%7b%7d>', 'Teams'],
    ['https://acme.webex.com/meet/jane', 'Webex'],
    ['https://meet.jit.si/MyRoom', 'Jitsi'],
  ];
  for (const [text, provider] of cases) assert.equal(findMeetingLink([text])?.provider, provider, text);
  assert.equal(findMeetingLink(['https://evil.example/zoom.us/j/123']), null);
  assert.equal(findMeetingLink(['no link here', '']), null);
});

test('priority: an earlier text wins over a later one', () => {
  const r = findMeetingLink(['https://meet.google.com/aaa-bbbb-ccc', 'https://zoom.us/j/999']);
  assert.equal(r.provider, 'Google Meet');
});

test('only web links can be opened', () => {
  for (const bad of ['javascript:alert(1)', 'file:///etc/passwd', 'ms-settings:', 'zoommtg://zoom.us/join?confno=1', '', null, 5]) {
    assert.equal(safeUrl(bad), null, String(bad));
  }
  assert.equal(safeUrl(' https://zoom.us/j/1 '), 'https://zoom.us/j/1');
  assert.equal(describeLink('https://www.example.com/room').provider, 'example.com');
  assert.equal(describeLink('nope'), null);
});

// ---------- schedule ----------
const mk = (title, startIso, mins, link = 'https://zoom.us/j/1') => ({
  key: `c|${title}|${D(startIso)}`, title, start: D(startIso), end: D(startIso) + mins * 60e3, link, provider: link ? 'Zoom' : null,
});

test('focus: next meeting, or the live one while it is fresh', () => {
  const a = mk('A', '2026-10-23T09:00:00Z', 30), b = mk('B', '2026-10-23T10:00:00Z', 30);
  assert.equal(S.pickFocus([a, b], D('2026-10-23T08:00:00Z')).meeting.title, 'A');
  assert.equal(S.pickFocus([a, b], D('2026-10-23T09:05:00Z')).state, 'live');
  assert.equal(S.pickFocus([a, b], D('2026-10-23T09:20:00Z')).meeting.title, 'B', 'A is half over, B is up next');
  assert.equal(S.pickFocus([a, b], D('2026-10-23T11:00:00Z')).state, 'none');
});

test('the join shortcut picks a live meeting with a link, else the next one with a link', () => {
  const a = mk('A', '2026-10-23T09:00:00Z', 60), nolink = mk('N', '2026-10-23T09:30:00Z', 30, null), c = mk('C', '2026-10-23T11:00:00Z', 30);
  assert.equal(S.pickJoinable([a, nolink, c], D('2026-10-23T09:40:00Z')).title, 'A');
  assert.equal(S.pickJoinable([a, nolink, c], D('2026-10-23T10:30:00Z')).title, 'C');
  assert.equal(S.pickJoinable([a], D('2026-10-23T12:00:00Z')), null);
  assert.equal(S.pickJoinable([nolink], D('2026-10-23T09:00:00Z')), null);
});

test('describing time in plain words', () => {
  const m = mk('A', '2026-10-23T09:00:00Z', 30);
  assert.equal(S.describeWhen(m, D('2026-10-23T08:50:30Z')), 'In 10 min');
  assert.equal(S.describeWhen(m, D('2026-10-23T08:59:30Z')), 'In 1 min');
  assert.equal(S.describeWhen(m, D('2026-10-23T09:00:10Z')), 'Starting now');
  assert.equal(S.describeWhen(m, D('2026-10-23T09:03:00Z')), 'Started 3 min ago');
  assert.equal(S.describeWhen(m, D('2026-10-23T07:30:00Z')), 'In 1 h 30 min');
  assert.equal(S.describeWhen(m, D('2026-10-23T07:00:00Z')), 'In 2 h');
});

test('reminders fire at each lead time, once', () => {
  const m = mk('A', '2026-10-23T09:00:00Z', 30);
  const fired = new Set();
  const run = (iso) => {
    const r = S.dueReminders([m], { leads: [10, 1], fired, now: D(iso) });
    r.mark.forEach((k) => fired.add(k));
    return r.show.map((x) => x.lead);
  };
  assert.deepEqual(run('2026-10-23T08:49:00Z'), []);
  assert.deepEqual(run('2026-10-23T08:50:05Z'), [10]);
  assert.deepEqual(run('2026-10-23T08:50:20Z'), [], 'not twice');
  assert.deepEqual(run('2026-10-23T08:59:10Z'), [1]);
  assert.deepEqual(run('2026-10-23T09:00:30Z'), []);
});

test('after sleep, only the closest reminder shows and older ones are cleared', () => {
  const m = mk('A', '2026-10-23T09:00:00Z', 30);
  const r = S.dueReminders([m], { leads: [10, 1], fired: new Set(), now: D('2026-10-23T08:59:30Z') });
  assert.deepEqual(r.show.map((x) => x.lead), [1]);
  assert.equal(r.mark.length, 2);
});

test('a meeting that already began still gets one reminder; one long over gets none', () => {
  const m = mk('A', '2026-10-23T09:00:00Z', 60);
  const late = S.dueReminders([m], { leads: [10, 1], fired: new Set(), now: D('2026-10-23T09:04:00Z') });
  assert.equal(late.show.length, 1);
  const tooLate = S.dueReminders([m], { leads: [10, 1], fired: new Set(), now: D('2026-10-23T09:40:00Z') });
  assert.equal(tooLate.show.length, 0);
  assert.equal(tooLate.mark.length, 2, 'cleared so it never comes back');
});

test('per-meeting settings: mute, and own lead times', () => {
  const m = mk('A', '2026-10-23T09:00:00Z', 30);
  const now = D('2026-10-23T08:55:30Z');
  assert.equal(S.dueReminders([m], { leads: [10, 1], fired: new Set(), now, perMeeting: { [m.key]: { mute: true } } }).show.length, 0);
  const own = S.dueReminders([m], { leads: [10, 1], fired: new Set(), now, perMeeting: { [m.key]: { leads: [5] } } });
  assert.deepEqual(own.show.map((x) => x.lead), [5]);
});

test('my own reminders: once, daily, weekdays, weekly', () => {
  const base = new Date(2026, 9, 21, 15, 30).getTime();             // Wed 21 Oct 2026, 15:30 local
  const win = { from: new Date(2026, 9, 23, 0, 0).getTime(), to: new Date(2026, 9, 29, 23, 59).getTime() };   // Fri 23 to Thu 29
  const names = (repeat) => S.expandManual([{ id: 'x', title: 'Call mum', startsAt: base, repeat }], win)
    .map((m) => new Date(m.start).toDateString().slice(0, 3));
  assert.deepEqual(names('once'), []);
  assert.deepEqual(names('daily'), ['Fri', 'Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu']);
  assert.deepEqual(names('weekdays'), ['Fri', 'Mon', 'Tue', 'Wed', 'Thu']);
  assert.deepEqual(names('weekly'), ['Wed']);
  const once = S.expandManual([{ id: 'y', title: 'Dentist', startsAt: new Date(2026, 9, 24, 9, 0).getTime(), repeat: 'once', link: 'https://x.test/j' }], win);
  assert.equal(once.length, 1); assert.equal(once[0].link, 'https://x.test/j');
});

test('a repeating reminder does not start before it was created', () => {
  const base = new Date(2026, 9, 23, 15, 30).getTime();
  const win = { from: new Date(2026, 9, 21, 0, 0).getTime(), to: new Date(2026, 9, 24, 23, 59).getTime() };
  const got = S.expandManual([{ id: 'x', title: 'T', startsAt: base, repeat: 'daily' }], win).map((m) => new Date(m.start).getDate());
  assert.deepEqual(got, [23, 24]);
});

// ---------- tray icon ----------
const px = (buf, size, x, y) => [...buf.subarray((y * size + x) * 4, (y * size + x) * 4 + 4)];

test('tray icon: right size, rounded corners, number in the right colour', () => {
  for (const size of [16, 32]) {
    const buf = renderTrayIcon({ text: '12', state: 'soon', size });
    assert.equal(buf.length, size * size * 4);
    assert.equal(px(buf, size, 0, 0)[3], 0, 'corner is transparent');
    assert.equal(px(buf, size, Math.floor(size / 2), 0)[3], 255, 'edge middle is filled');
    const lit = []; for (let i = 0; i < buf.length; i += 4) if (buf[i] === 255 && buf[i + 1] === 90) lit.push(i);
    assert.ok(lit.length > size, 'orange digit pixels exist');
  }
});

test('tray icon: different numbers look different; empty state is a dot', () => {
  assert.notDeepEqual(renderTrayIcon({ text: '5', size: 16 }), renderTrayIcon({ text: '6', size: 16 }));
  const dot = renderTrayIcon({ text: '', state: 'idle', size: 16 });
  const lit = []; for (let i = 0; i < dot.length; i += 4) if (dot[i] === 138) lit.push(i);
  assert.equal(lit.length, 16, 'a 4x4 dot');
  assert.deepEqual([stateFor(3, false), stateFor(30, false), stateFor(null, false), stateFor(3, true)], ['soon', 'later', 'idle', 'live']);
});

// ---------- store ----------
test('settings: defaults, cleaning, and survives junk', () => {
  assert.deepEqual(merge(null).leads, [10, 1]);
  assert.deepEqual(merge({ leads: ['5', 5, 1, -3, 'x', 99999] }).leads, [5, 1]);
  assert.deepEqual(merge({ leads: [] }).leads, [], 'someone who wants no reminders gets none');
  assert.equal(merge({ calendars: [null, { url: 5 }, { id: 'a', url: 'https://x' }] }).calendars.length, 1);
  assert.deepEqual(cleanLeads(['3', 3, '10']), [10, 3]);
});

test('settings file: saved atomically and read back', () => {
  const os = require('os'), fs = require('fs'), path = require('path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'joinbar-'));
  const file = path.join(dir, 'sub', 'settings.json');
  const s = new Store(file);
  s.patch({ leads: [15, 2], hotkey: 'Control+Shift+J' });
  assert.deepEqual(new Store(file).data.leads, [15, 2]);
  fs.writeFileSync(file, '{broken');
  assert.deepEqual(new Store(file).data.leads, [10, 1], 'a corrupted file falls back to defaults');
  s.data.fired = { a: 1, b: Date.now() }; s.pruneFired(Date.now());
  assert.deepEqual(Object.keys(s.data.fired), ['b']);
});

test('my own reminders use their own lead time, not the meeting defaults', () => {
  const at = new Date(2026, 9, 23, 15, 30).getTime();
  const [m] = S.expandManual([{ id: 'z', title: 'Call mum', startsAt: at, repeat: 'once', lead: 3 }], { from: at - 3600e3, to: at + 3600e3 });
  assert.deepEqual(m.leads, [3]);
  const r = (now) => S.dueReminders([m], { leads: [10, 1], fired: new Set(), now }).show.length;
  assert.equal(r(at - 5 * 60e3), 0, 'the global 10-minute lead does not apply');
  assert.equal(r(at - 2.9 * 60e3), 1);
});

test('PNG encoder writes a valid file', () => {
  const { encodePng, crc32 } = require('../src/core/png');
  const zlib = require('zlib');
  const rgba = Buffer.from([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 255, 1, 2, 3, 4]);
  const png = encodePng(rgba, 2, 2);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.readUInt32BE(16), 2); assert.equal(png.readUInt32BE(20), 2);
  const idatLen = png.readUInt32BE(33), idat = png.subarray(41, 41 + idatLen);
  const raw = zlib.inflateSync(idat);
  assert.equal(raw.length, 2 * (2 * 4 + 1));
  assert.deepEqual([...raw.subarray(1, 9)], [...rgba.subarray(0, 8)]);
  assert.equal(png.readUInt32BE(41 + idatLen), crc32(png.subarray(37, 41 + idatLen)));
  assert.throws(() => encodePng(Buffer.alloc(3), 2, 2));
});
