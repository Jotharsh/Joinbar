'use strict';
// Sample data for trying the app without a real calendar, and for taking screenshots.
const fs = require('fs');
const path = require('path');

const pad = (n) => String(n).padStart(2, '0');
const ics = (t) => { const d = new Date(t); return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`; };

function demoCalendar(now = Date.now()) {
  const MIN = 60e3, H = 3600e3;
  const ev = (uid, title, start, mins, extra = '') =>
    `BEGIN:VEVENT\r\nUID:${uid}@demo\r\nDTSTART:${ics(start)}\r\nDTEND:${ics(start + mins * MIN)}\r\nSUMMARY:${title}\r\n${extra}END:VEVENT\r\n`;
  const tomorrow9 = new Date(now); tomorrow9.setDate(tomorrow9.getDate() + 1); tomorrow9.setHours(9, 30, 0, 0);
  return 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//joinbar demo//EN\r\n'
    + ev('live', 'Sprint planning', now - 3 * MIN, 45, 'DESCRIPTION:Join: https://acme.zoom.us/j/84012345678?pwd=demo\r\n')
    + ev('next', 'Design review', now + 12 * MIN + 20e3, 30, 'LOCATION:https://meet.google.com/abc-defg-hij\r\n')
    + ev('lunch', 'Lunch with Sam', now + 2 * H, 60, 'LOCATION:Cafe Zoe\r\n')
    + ev('one', '1:1 with Priya', now + 4 * H, 30, 'DESCRIPTION:https://teams.microsoft.com/l/meetup-join/19%3ameeting_demo/0\r\n')
    + ev('tomorrow', 'Team standup', tomorrow9.getTime(), 15, 'LOCATION:https://meet.google.com/xyz-uvwx-rst\r\n')
    + 'END:VCALENDAR\r\n';
}

function install(store, cacheFile) {
  fs.mkdirSync(path.dirname(cacheFile('demo')), { recursive: true });
  fs.writeFileSync(cacheFile('demo'), demoCalendar());
  store.data.calendars = [{ id: 'demo', name: 'Work', url: 'https://example.invalid/demo.ics', enabled: true }];
  const at = new Date(); at.setHours(at.getHours() + 3, 0, 0, 0);
  store.data.manual = [{ id: 'm1', title: 'Call the landlord', startsAt: at.getTime(), repeat: 'once', lead: 5, link: 'https://meet.google.com/lan-dlor-dxx', provider: 'Google Meet' }];
  store.data.fired = {};
}

/** Takes pictures of each screen and quits. */
async function shoot({ SHOTS_DIR, showPopup, popup, queueToast, meetings, toast, app }) {
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const save = async (win, name) => { const img = await win.webContents.capturePage(); fs.writeFileSync(path.join(SHOTS_DIR, `${name}.png`), img.toPNG()); };
  await wait(1200);
  showPopup('meetings'); await wait(800); await save(popup(), 'meetings');
  popup().webContents.send('jb:tab', 'reminders'); await wait(500); await save(popup(), 'reminders');
  popup().webContents.send('jb:tab', 'settings'); await wait(500); await save(popup(), 'settings');
  const next = meetings().find((m) => m.title === 'Design review');
  if (toast()) toast().close(); await wait(900); queueToast({ meeting: next, lead: 10 }); await wait(1300); if (toast()) await save(toast(), 'reminder');
  app.quit();
}

module.exports = { install, shoot, demoCalendar };
