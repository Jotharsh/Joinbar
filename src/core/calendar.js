'use strict';
const ICAL = require('ical.js');
const { findMeetingLink } = require('./links');

const MAX_OCCURRENCES = 2000;     // safety stop for runaway recurring rules

/**
 * Reads calendar text (.ics) and returns the meetings that overlap [from, to] (milliseconds),
 * with recurring events expanded, one-off changes applied, and cancelled ones dropped.
 */
function parseCalendar(icsText, { from, to, calendarId = 'cal', calendarName = '' }) {
  const root = new ICAL.Component(ICAL.parse(icsText));
  for (const tz of root.getAllSubcomponents('vtimezone')) {
    try { ICAL.TimezoneService.register(tz); } catch { /* an unreadable timezone is skipped */ }
  }

  const masters = new Map();       // uid -> ICAL.Event
  const exceptions = [];
  for (const vevent of root.getAllSubcomponents('vevent')) {
    const event = new ICAL.Event(vevent);
    if (event.isRecurrenceException()) exceptions.push(event);
    else masters.set(event.uid, event);
  }
  for (const ex of exceptions) masters.get(ex.uid)?.relateException(ex);

  const out = [];
  const add = (event, startTime, endTime) => {
    const allDay = startTime.isDate;
    if (allDay) return;                                          // all-day items are not meetings
    if (/^cancel/i.test(String(event.component.getFirstPropertyValue('status') || ''))) return;
    const start = startTime.toJSDate().getTime();
    const end = endTime ? endTime.toJSDate().getTime() : start + 30 * 60e3;
    if (end < from || start > to) return;

    const comp = event.component;
    const conf = comp.getFirstPropertyValue('x-google-conference');
    const link = findMeetingLink([
      typeof conf === 'string' ? conf : '',
      String(comp.getFirstPropertyValue('url') || ''),
      String(event.location || ''),
      String(event.description || ''),
    ]);
    out.push({
      key: `${calendarId}|${event.uid}|${start}`,
      title: (event.summary || '(no title)').trim(),
      start, end,
      link: link ? link.url : null,
      provider: link ? link.provider : null,
      location: event.location || '',
      calendarId, calendarName,
    });
  };

  for (const event of masters.values()) {
    try {
      if (event.isRecurring()) {
        const it = event.iterator();
        let next, n = 0;
        while ((next = it.next()) && n++ < MAX_OCCURRENCES) {
          if (next.toJSDate().getTime() > to) break;
          const d = event.getOccurrenceDetails(next);
          add(d.item, d.startDate, d.endDate);
        }
      } else {
        add(event, event.startDate, event.endDate);
      }
    } catch { /* one broken event must not hide the rest */ }
  }
  out.sort((a, b) => a.start - b.start || a.title.localeCompare(b.title));
  return out;
}

module.exports = { parseCalendar };
