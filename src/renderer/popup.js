'use strict';
const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null) n.append(kid);
  return n;
};
const svg = (d) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('width', 16); s.setAttribute('height', 16); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', 2); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); for (const p of d) { const e = document.createElementNS('http://www.w3.org/2000/svg', 'path'); e.setAttribute('d', p); s.append(e); } return s; };
const BELL = ['M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9', 'M13.7 21a2 2 0 0 1-3.4 0'];
const BELL_OFF = ['M13.7 21a2 2 0 0 1-3.4 0', 'M18.6 13A17 17 0 0 1 18 8a6 6 0 0 0-9.3-5', 'M6.3 6.3A6 6 0 0 0 6 8c0 7-3 9-3 9h14', 'M2 2l20 20'];
const TRASH = ['M3 6h18', 'M8 6V4h8v2', 'M19 6l-1 14H6L5 6'];

let S = null;                 // latest state from the app
let openBell = null;          // meeting key whose reminder options are open

const fmtTime = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const fmtDay = (t) => {
  const d = new Date(t), today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - today) / 86400e3);
  if (diff === 0) return 'Today'; if (diff === 1) return 'Tomorrow';
  return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' });
};
const dayKey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
const leadText = (n) => (n === 0 ? 'At start' : `${n} min`);

// ---------------------------------------------------------------- tabs
function showTab(name) {
  for (const b of document.querySelectorAll('.tabs button')) b.setAttribute('aria-selected', String(b.dataset.tab === name));
  for (const s of document.querySelectorAll('main > section')) s.hidden = s.id !== `tab-${name}`;
  document.querySelector('main').scrollTop = 0;
}
document.querySelector('.tabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) showTab(b.dataset.tab); });
window.joinbar.onTab(showTab);
$('refresh').addEventListener('click', () => window.joinbar.do({ type: 'refresh' }));

// ---------------------------------------------------------------- meetings
function renderFocus() {
  const box = $('focus'); box.replaceChildren();
  const { meeting: m, state } = S.focus;
  if (!m) {
    box.append(el('div', { class: 'empty' },
      el('h3', { text: S.settings.calendars.length || S.settings.manual.length ? 'Nothing coming up' : 'Add your calendar' }),
      el('div', { text: S.settings.calendars.length || S.settings.manual.length ? 'Enjoy the quiet.' : 'Paste a calendar link and your meetings appear here.' }),
      S.settings.calendars.length ? null : el('button', { class: 'btn primary', text: 'Add a calendar', onclick: () => showTab('settings') })));
    return;
  }
  const live = state === 'live';
  box.append(el('div', { class: `focus${live ? ' live' : ''}` },
    el('div', { class: 'label' }, el('span', { class: 'dot' }), el('span', { text: `${live ? 'On now' : 'Next'} · ${m.when}` })),
    el('h3', { text: m.title }),
    el('div', { class: 'meta' }, el('span', { text: `${fmtTime(m.start)} – ${fmtTime(m.end)}` }), m.provider ? el('span', { class: 'chip', text: m.provider }) : null),
    m.link ? el('button', { class: 'btn primary big', text: live ? 'Join now' : 'Join', onclick: () => window.joinbar.do({ type: 'join', key: m.key }) })
           : el('div', { class: 'nolink', text: 'No video link in this event' })));
}

function bellPanel(m) {
  const effective = m.leads || S.settings.leads;
  const choices = [...new Set([15, 10, 5, 2, 1, 0, ...effective])].sort((a, b) => b - a);
  return el('div', { class: 'panel' },
    el('div', { class: 'line' }, el('strong', { text: 'Remind me before this meeting' }),
      m.leads ? el('button', { class: 'link', text: 'Use my defaults', onclick: () => window.joinbar.do({ type: 'meetingReminder', key: m.key, leads: null }) }) : null),
    el('div', { class: 'chips' }, choices.map((n) => el('button', {
      class: 'chip toggle', 'aria-pressed': String(effective.includes(n) && !m.mute), text: leadText(n),
      onclick: () => window.joinbar.do({ type: 'meetingReminder', key: m.key, mute: false, leads: effective.includes(n) ? effective.filter((x) => x !== n) : [...effective, n] }),
    }))),
    el('div', { class: 'line' }, el('span', { text: 'No reminders for this one' }),
      el('button', { class: 'toggle', role: 'switch', 'aria-checked': String(m.mute), 'aria-label': 'Mute reminders for this meeting',
        onclick: () => window.joinbar.do({ type: 'meetingReminder', key: m.key, mute: !m.mute }) })));
}

function renderList() {
  const box = $('list'); box.replaceChildren();
  const groups = new Map();
  for (const m of S.meetings) { const k = dayKey(m.start); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(m); }
  for (const items of groups.values()) {
    const day = el('div', { class: 'day' }, el('h2', { text: fmtDay(items[0].start) }));
    for (const m of items) {
      const past = m.end <= S.now;
      day.append(el('div', { class: `row${past ? ' past' : ''}` },
        el('div', { class: 'time', text: fmtTime(m.start) }),
        el('div', { style: 'min-width:0' }, el('div', { class: 'title', text: m.title }),
          el('div', { class: 'sub', text: [m.provider, m.calendarName].filter(Boolean).join(' · ') || 'No link' })),
        el('div', { class: 'actions' },
          past ? null : el('button', { class: `iconbtn${m.mute || m.leads ? ' on' : ''}`, title: 'Reminders for this meeting', 'aria-label': `Reminders for ${m.title}`,
            onclick: () => { openBell = openBell === m.key ? null : m.key; renderList(); } }, svg(m.mute ? BELL_OFF : BELL)),
          !past && m.link ? el('button', { class: 'join', text: 'Join', 'aria-label': `Join ${m.title}`, onclick: () => window.joinbar.do({ type: 'join', key: m.key }) }) : null),
        openBell === m.key && !past ? bellPanel(m) : null));
    }
    box.append(day);
  }
}

// ---------------------------------------------------------------- reminders tab
function renderLeads() {
  const box = $('leads'); box.replaceChildren();
  if (!S.settings.leads.length) box.append(el('span', { class: 'hint', text: 'No reminders. Meetings will not pop up.' }));
  for (const n of S.settings.leads) {
    box.append(el('span', { class: 'pill' }, el('span', { text: n === 0 ? 'At start' : `${n} min before` }),
      el('button', { 'aria-label': `Remove ${n} minutes`, text: '×', onclick: () => window.joinbar.do({ type: 'setting', key: 'leads', value: S.settings.leads.filter((x) => x !== n) }) })));
  }
}
$('leadAdd').addEventListener('click', () => {
  const n = Math.round(Number($('leadInput').value));
  if (!Number.isFinite(n) || n < 0 || $('leadInput').value === '') return;
  window.joinbar.do({ type: 'setting', key: 'leads', value: [...S.settings.leads, n] });
  $('leadInput').value = '';
});

const repeatText = { once: '', daily: 'Every day', weekdays: 'Every weekday', weekly: 'Every week' };
function renderManual() {
  const box = $('manualList'); box.replaceChildren();
  if (!S.settings.manual.length) { box.append(el('p', { class: 'hint', text: 'Nothing yet. Add one above, with a link, and the pop-up will have a Join button.' })); return; }
  for (const r of S.settings.manual) {
    const when = new Date(r.startsAt);
    const text = r.repeat === 'once' ? `${when.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} · ${fmtTime(r.startsAt)}` : `${repeatText[r.repeat]} · ${fmtTime(r.startsAt)}`;
    box.append(el('div', { class: 'item' },
      el('div', { class: 'grow' }, el('div', { class: 't', text: r.title }), el('div', { class: 's', text: `${text}${r.provider ? ` · ${r.provider}` : ''}` })),
      el('button', { class: 'iconbtn', title: 'Delete', 'aria-label': `Delete ${r.title}`, onclick: () => window.joinbar.do({ type: 'removeManual', id: r.id }) }, svg(TRASH))));
  }
}
(function defaultWhen() {
  const d = new Date(Date.now() + 3600e3); d.setMinutes(0, 0, 0);
  const p = (n) => String(n).padStart(2, '0');
  $('mWhen').value = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
})();
$('manualForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const r = await window.joinbar.do({ type: 'addManual', title: $('mTitle').value, startsAt: new Date($('mWhen').value).getTime(),
    repeat: $('mRepeat').value, lead: Number($('mLead').value), link: $('mLink').value });
  $('mError').textContent = r.ok ? '' : r.error || 'Could not add that.';
  if (r.ok) { $('mTitle').value = ''; $('mLink').value = ''; }
});

// ---------------------------------------------------------------- settings tab
function renderCalendars() {
  const box = $('calList'); box.replaceChildren();
  if (!S.settings.calendars.length) box.append(el('p', { class: 'hint', text: 'No calendar yet.' }));
  for (const c of S.settings.calendars) {
    const st = c.status;
    const line = !c.enabled ? 'Off' : !st ? 'Waiting…' : st.ok === false ? st.error : `Synced ${new Date(st.at || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    box.append(el('div', { class: 'item' },
      el('div', { class: 'grow' }, el('div', { class: 't', text: c.name }), el('div', { class: `s ${st && st.ok === false && c.enabled ? 'status-bad' : st && st.ok ? 'status-ok' : ''}`, text: line })),
      el('button', { class: 'toggle', role: 'switch', 'aria-checked': String(c.enabled), 'aria-label': `Use ${c.name}`, onclick: () => window.joinbar.do({ type: 'toggleCalendar', id: c.id }) }),
      el('button', { class: 'iconbtn', title: 'Remove', 'aria-label': `Remove ${c.name}`, onclick: () => window.joinbar.do({ type: 'removeCalendar', id: c.id }) }, svg(TRASH))));
  }
}
$('calForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const r = await window.joinbar.do({ type: 'addCalendar', name: $('cName').value, url: $('cUrl').value });
  $('cError').textContent = r.ok ? '' : r.error;
  if (r.ok) { $('cName').value = ''; $('cUrl').value = ''; }
});

const setSwitch = (id, on) => $(id).setAttribute('aria-checked', String(!!on));
for (const [id, key] of [['optLogin', 'launchAtLogin'], ['optSound', 'sound']]) {
  $(id).addEventListener('click', () => window.joinbar.do({ type: 'setting', key, value: $(id).getAttribute('aria-checked') !== 'true' }));
}
$('optSnooze').addEventListener('change', () => window.joinbar.do({ type: 'setting', key: 'snoozeMinutes', value: Number($('optSnooze').value) }));
$('testToast').addEventListener('click', () => window.joinbar.do({ type: 'testReminder' }));

// hotkey recorder
const KEYNAMES = { ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Space: 'Space', Enter: 'Return', Backspace: 'Backspace', Tab: 'Tab' };
function keyFrom(e) {
  if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3);
  if (/^Digit\d$/.test(e.code)) return e.code.slice(5);
  if (/^F\d{1,2}$/.test(e.code)) return e.code;
  return KEYNAMES[e.code] || null;
}
let listening = false;
const showHotkey = () => { $('hotkey').textContent = listening ? 'Press the keys…' : (S ? S.settings.hotkey.replace('Control', 'Ctrl').replaceAll('+', ' + ') : ''); $('hotkey').classList.toggle('listening', listening); };
$('hotkey').addEventListener('click', () => { listening = !listening; showHotkey(); });
$('hotkey').addEventListener('blur', () => { listening = false; showHotkey(); });
$('hotkey').addEventListener('keydown', async (e) => {
  if (!listening) return;
  e.preventDefault();
  if (e.key === 'Escape') { listening = false; showHotkey(); return; }
  const key = keyFrom(e);
  const mods = [e.ctrlKey && 'Control', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super'].filter(Boolean);
  if (!key || !mods.length) { $('hkError').textContent = 'Hold Ctrl, Alt or Shift and press a letter, number or F-key.'; return; }
  listening = false;
  const r = await window.joinbar.do({ type: 'setting', key: 'hotkey', value: [...mods, key].join('+') });
  $('hkError').textContent = r.ok ? '' : r.error;
  showHotkey();
});

// ---------------------------------------------------------------- go
function render(state) {
  S = state;
  renderFocus(); renderList(); renderLeads(); renderManual(); renderCalendars();
  setSwitch('optLogin', S.settings.launchAtLogin); setSwitch('optSound', S.settings.sound);
  $('optSnooze').value = String(S.settings.snoozeMinutes);
  if (!listening) showHotkey();
  $('hkError').textContent = S.settings.hotkeyError || $('hkError').textContent;
  $('about').textContent = `Joinbar ${S.version}. Your calendar links and reminders are stored only on this PC.`;
}
window.joinbar.onState(render);
window.joinbar.state().then((s) => { if (s) render(s); });
setInterval(() => window.joinbar.state().then((s) => { if (s) render(s); }), 30000);
