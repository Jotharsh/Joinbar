'use strict';
const $ = (id) => document.getElementById(id);
let data = null;

const fmt = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
function when(m, now) {
  if (now >= m.start) { const ago = Math.floor((now - m.start) / 60e3); return ago <= 0 ? 'Starting now' : `Started ${ago} min ago`; }
  const mins = Math.ceil((m.start - now) / 60e3);
  return mins <= 1 ? 'Starts in 1 min' : `Starts in ${mins} min`;
}
function draw() {
  const m = data.meeting, now = Date.now();
  $('label').textContent = when(m, now);
  $('label').classList.toggle('now', now >= m.start);
  $('meta').textContent = `${fmt(m.start)} – ${fmt(m.end)}${m.provider ? ` · ${m.provider}` : ''}`;
  if (now >= m.end) window.joinbar.toastAction('dismiss');
}
window.joinbar.toast().then((d) => {
  if (!d) return;
  data = d;
  $('title').textContent = d.meeting.title;
  $('join').hidden = !d.meeting.link;
  $('snooze').textContent = `Snooze ${d.snoozeMinutes} min`;
  draw(); setInterval(draw, 1000);
  (d.meeting.link ? $('join') : $('snooze')).focus();
});
$('join').addEventListener('click', () => window.joinbar.toastAction('join'));
$('snooze').addEventListener('click', () => window.joinbar.toastAction('snooze'));
$('dismiss').addEventListener('click', () => window.joinbar.toastAction('dismiss'));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.joinbar.toastAction('dismiss'); });
