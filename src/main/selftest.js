'use strict';
// `electron . --selftest` runs the real app with sample data and checks it behaves. Links are recorded, not opened.
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(ctx) {
  const results = [];
  const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${ok ? '' : `  -> ${detail}`}`); };
  const { handleAction: act, snapshot, meetings, opened, store } = ctx;
  await wait(500);

  const live = meetings().find((m) => m.title === 'Sprint planning');
  const next = meetings().find((m) => m.title === 'Design review');
  check('sample calendar loaded', !!live && !!next && live.provider === 'Zoom' && next.provider === 'Google Meet');
  check('focus card is the meeting that is on now', snapshot().focus.state === 'live' && snapshot().focus.meeting.title === 'Sprint planning');
  check('tray icon shows "live"', ctx.lastIcon() === '!|live', ctx.lastIcon());

  // join
  check('join opens the meeting link', act({ type: 'join', key: live.key }).ok && opened.at(-1) === live.link, opened.at(-1));
  check('join with an unknown key does nothing', !act({ type: 'join', key: 'nope' }).ok && opened.length === 1);
  check('join hotkey handler opens the live meeting', (ctx.onHotkey(), opened.at(-1) === live.link));

  // my own reminders
  const at = Date.now() + 2 * 3600e3;
  check('a reminder with a javascript: link is refused', !act({ type: 'addManual', title: 'x', startsAt: at, link: 'javascript:alert(1)' }).ok);
  check('a reminder with no name is refused', !act({ type: 'addManual', title: '  ', startsAt: at }).ok);
  check('a reminder with no time is refused', !act({ type: 'addManual', title: 'x', startsAt: NaN }).ok);
  const r = act({ type: 'addManual', title: 'Call the bank', startsAt: at, repeat: 'once', lead: 2, link: 'https://meet.jit.si/bank' });
  const made = snapshot().meetings.find((m) => m.title === 'Call the bank');
  check('a good reminder is added with its link and provider', r.ok && made && made.link === 'https://meet.jit.si/bank' && made.provider === 'Jitsi', JSON.stringify(made));
  check('and it survives in the saved file', store.data.manual.some((m) => m.title === 'Call the bank'));
  check('join on my own reminder opens its link', (act({ type: 'join', key: made.key }), opened.at(-1) === 'https://meet.jit.si/bank'));
  act({ type: 'removeManual', id: made.manualId });
  check('a reminder can be deleted', !snapshot().meetings.some((m) => m.title === 'Call the bank'));

  // calendars
  for (const bad of ['', 'not a url', 'file:///etc/passwd', 'javascript:alert(1)', 'ftp://x.test/a.ics']) {
    check(`calendar link "${bad}" is refused`, !act({ type: 'addCalendar', name: 'x', url: bad }).ok);
  }
  check('no calendar was added by those', store.data.calendars.length === 1);

  // reminders: global lead times
  act({ type: 'setting', key: 'leads', value: [30, 10, 10, -1, 'abc'] });
  check('lead times are cleaned', JSON.stringify(store.data.leads) === '[30,10]', JSON.stringify(store.data.leads));
  ctx.tick(); await wait(200);
  check('a meeting 12 min away is inside the 30-minute lead, so a reminder is queued or showing',
    ctx.toastQueue.some((q) => q.meeting.title === 'Design review') || (ctx.toastShowing() && ctx.toastShowing().meeting.title === 'Design review') || store.data.fired[`${next.key}#30`] !== undefined);

  // mute / per-meeting
  act({ type: 'meetingReminder', key: next.key, mute: true });
  check('muting a meeting is remembered', snapshot().meetings.find((m) => m.key === next.key).mute === true);
  act({ type: 'meetingReminder', key: next.key, mute: false, leads: [1] });
  check('own lead times are remembered', JSON.stringify(snapshot().meetings.find((m) => m.key === next.key).leads) === '[1]');
  act({ type: 'meetingReminder', key: next.key, leads: null });
  check('and can go back to the defaults', snapshot().meetings.find((m) => m.key === next.key).leads === null);

  // toast pop-ups come one at a time; step through whatever is waiting until ours shows
  act({ type: 'testReminder' });
  let shown = false;
  for (let i = 0; i < 8 && !shown; i++) {
    await wait(900);
    shown = !!ctx.toastShowing() && ctx.toastShowing().meeting.title === 'Test reminder';
    if (!shown) ctx.closeToast();
  }
  check('a test reminder pop-up appears (after any others waiting)', shown);
  ctx.closeToast(); await wait(700);
  check('closing it leaves nothing showing', !ctx.toastShowing());

  // hotkey
  const ok = ctx.registerHotkey('Control+Alt+K');
  check('the hotkey can be changed', ok.ok && store.data.hotkey === 'Control+Alt+K');
  const bad = ctx.registerHotkey('NotAKey+++');
  check('a nonsense hotkey is refused and the old one is kept', !bad.ok && store.data.hotkey === 'Control+Alt+K');

  check('unknown actions are refused', !act({ type: 'format-disk' }).ok && !act(null).ok);

  // real network fetch, against a small local server
  const http = require('http');
  const { demoCalendar } = require('./demo');
  const soon = Date.now() + 25 * 60e3;
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = (t) => { const d = new Date(t); return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`; };
  const body = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:net1\r\nDTSTART:${stamp(soon)}\r\nDTEND:${stamp(soon + 1800e3)}\r\nSUMMARY:Network meeting\r\nDESCRIPTION:https://acme.webex.com/meet/jane\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
  const server = http.createServer((req, res) => {
    if (req.url === '/cal.ics') { res.setHeader('content-type', 'text/calendar'); res.end(body); }
    else if (req.url === '/page.html') { res.end('<html>hello</html>'); }
    else { res.statusCode = 404; res.end('no'); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const calStatus = (name) => snapshot().settings.calendars.find((c) => c.name === name);
  const waitFor = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await wait(100); } return false; };

  ctx.setDemo(false);
  act({ type: 'addCalendar', name: 'Net', url: `${base}/cal.ics` });
  check('a calendar added by link is fetched and its meeting appears', await waitFor(() => meetings().some((m) => m.title === 'Network meeting' && m.provider === 'Webex')));
  check('and the calendar reports it synced', !!calStatus('Net') && calStatus('Net').status && calStatus('Net').status.ok === true);

  act({ type: 'addCalendar', name: 'Dead', url: `${base}/gone.ics` });
  check('a link that returns 404 shows a helpful message', await waitFor(() => calStatus('Dead') && calStatus('Dead').status && /no longer works/.test(calStatus('Dead').status.error || '')), JSON.stringify(calStatus('Dead')));
  act({ type: 'addCalendar', name: 'Page', url: `${base}/page.html` });
  check('a web page that is not a calendar is explained', await waitFor(() => calStatus('Page') && calStatus('Page').status && /not a calendar/.test(calStatus('Page').status.error || '')), JSON.stringify(calStatus('Page')));

  await new Promise((r) => server.close(r));
  act({ type: 'refresh' });
  check('with the network gone, the saved copy is still used and the message says so',
    await waitFor(() => calStatus('Net').status && calStatus('Net').status.ok === false && /last copy/.test(calStatus('Net').status.error || '')) && meetings().some((m) => m.title === 'Network meeting'), JSON.stringify(calStatus('Net')));

  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  ctx.app.exit(failed ? 1 : 0);
}

module.exports = { run };
