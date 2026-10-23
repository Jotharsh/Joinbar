'use strict';
// What to show and when to remind. Pure functions: give them the time, get an answer.

const MIN = 60e3;
const JOIN_WINDOW_AFTER_START = 15 * MIN;    // a meeting that began up to 15 min ago still counts as "now"

/** The meeting to put in front of the user: one that is on now, else the next to start. */
function pickFocus(meetings, now) {
  const live = meetings.find((m) => m.start <= now && now < m.end);
  const next = meetings.find((m) => m.start > now);
  if (live && now - live.start <= JOIN_WINDOW_AFTER_START) return { meeting: live, state: 'live' };
  if (next) return { meeting: next, state: 'upcoming' };
  if (live) return { meeting: live, state: 'live' };
  return { meeting: null, state: 'none' };
}

/** The meeting the join hotkey should open: prefers live, then next, and only those with a link. */
function pickJoinable(meetings, now) {
  const live = meetings.filter((m) => m.link && m.start <= now && now < m.end);
  if (live.length) return live[live.length - 1];
  return meetings.find((m) => m.link && m.start > now) || null;
}

/** Whole minutes until a time, rounded up so "0:30 left" reads as 1. */
const minutesUntil = (t, now) => Math.max(0, Math.ceil((t - now) / MIN));

function describeWhen(meeting, now) {
  if (now >= meeting.start && now < meeting.end) {
    const ago = Math.floor((now - meeting.start) / MIN);
    return ago <= 0 ? 'Starting now' : `Started ${ago} min ago`;
  }
  if (now >= meeting.end) return 'Ended';
  const m = minutesUntil(meeting.start, now);
  if (m <= 1) return 'In 1 min';
  if (m < 60) return `In ${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `In ${h} h ${r} min` : `In ${h} h`;
}

/**
 * Which reminders should pop up right now.
 *   leads:        minutes before start, e.g. [10, 1]
 *   perMeeting:   { [meeting.key]: { leads?: number[], mute?: boolean } }
 *   fired:        Set of strings already shown ("key#lead")
 * When several are due at once (the computer was asleep), only the closest to the start shows,
 * and the older ones are marked as handled. A meeting that already began (within the join window)
 * gets one "started" reminder. Returns { show: [{meeting, lead}], mark: [strings] }.
 */
function dueReminders(meetings, { leads, perMeeting = {}, fired, now }) {
  const show = [], mark = [];
  for (const m of meetings) {
    const own = perMeeting[m.key] || {};
    if (own.mute) continue;
    if (now >= m.end) continue;
    const list = [...new Set((own.leads || m.leads || leads).map(Number).filter((n) => n >= 0))].sort((a, b) => b - a);
    const due = list.filter((lead) => m.start - lead * MIN <= now && !fired.has(`${m.key}#${lead}`));
    if (!due.length) continue;
    if (now > m.start + JOIN_WINDOW_AFTER_START) { due.forEach((l) => mark.push(`${m.key}#${l}`)); continue; }
    const closest = due[due.length - 1];
    due.forEach((l) => mark.push(`${m.key}#${l}`));
    show.push({ meeting: m, lead: closest });
  }
  show.sort((a, b) => a.meeting.start - b.meeting.start);
  return { show, mark };
}

/** Turns the user's own reminders into meetings for a window, so they flow through the same code. */
function expandManual(manual, { from, to }) {
  const out = [];
  for (const r of manual) {
    if (!r.title || !Number.isFinite(r.startsAt)) continue;
    const base = new Date(r.startsAt);
    const dayMs = 86400e3;
    const push = (start) => {
      if (start + 30 * MIN < from || start > to) return;
      out.push({ key: `manual|${r.id}|${start}`, title: r.title, start, end: start + (r.minutes || 30) * MIN,
        link: r.link || null, provider: r.provider || null, leads: [Number.isFinite(r.lead) ? r.lead : 5], location: '', calendarId: 'manual', calendarName: 'My reminders', manualId: r.id });
    };
    const repeat = r.repeat || 'once';
    if (repeat === 'once') { push(r.startsAt); continue; }
    // walk days from the window's start so a reminder created weeks ago still repeats today
    const first = Math.max(from - dayMs, r.startsAt);
    const cursor = new Date(first); cursor.setHours(0, 0, 0, 0);
    for (let t = cursor.getTime(); t <= to + dayMs; t += dayMs) {
      const d = new Date(t);
      const at = new Date(d.getFullYear(), d.getMonth(), d.getDate(), base.getHours(), base.getMinutes(), 0, 0).getTime();
      if (at < r.startsAt) continue;
      const wd = new Date(at).getDay();
      if (repeat === 'weekdays' && (wd === 0 || wd === 6)) continue;
      if (repeat === 'weekly' && wd !== base.getDay()) continue;
      push(at);
    }
  }
  return out;
}

module.exports = { pickFocus, pickJoinable, minutesUntil, describeWhen, dueReminders, expandManual, MIN, JOIN_WINDOW_AFTER_START };
