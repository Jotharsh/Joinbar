'use strict';
// Finds the link someone would click to join a meeting, in an event's text.

const PROVIDERS = [
  { name: 'Zoom', re: /https?:\/\/(?:[\w-]+\.)?zoom\.us\/(?:j|my|wc\/join|w)\/[^\s"'<>)\]]+/i },
  { name: 'Google Meet', re: /https?:\/\/meet\.google\.com\/(?:lookup\/)?[a-z0-9_-]+(?:\?[^\s"'<>)\]]*)?/i },
  { name: 'Teams', re: /https?:\/\/teams\.(?:microsoft|live)\.com\/(?:l\/meetup-join|meet)\/[^\s"'<>)\]]+/i },
  { name: 'Webex', re: /https?:\/\/(?:[\w-]+\.)?webex\.com\/(?:meet|join|[\w-]+\/j\.php)[^\s"'<>)\]]*/i },
  { name: 'Whereby', re: /https?:\/\/whereby\.com\/[^\s"'<>)\]]+/i },
  { name: 'Jitsi', re: /https?:\/\/meet\.jit\.si\/[^\s"'<>)\]]+/i },
  { name: 'GoToMeeting', re: /https?:\/\/(?:global\.)?gotomeet\.me\/[^\s"'<>)\]]+|https?:\/\/(?:[\w-]+\.)?gotomeeting\.com\/join\/[^\s"'<>)\]]+/i },
  { name: 'Slack huddle', re: /https?:\/\/app\.slack\.com\/huddle\/[^\s"'<>)\]]+/i },
  { name: 'Discord', re: /https?:\/\/discord\.(?:com\/channels|gg)\/[^\s"'<>)\]]+/i },
];

const ANY_URL = /https?:\/\/[^\s"'<>)\]]+/i;

/** Calendar text escapes things (\, \n) and often ends a link with punctuation; undo that. */
function tidy(url) {
  return url
    .replace(/\\[nN]/g, '')
    .replace(/\\([,;])/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/[.,;:!?'"]+$/, '');
}

/** Only web links may be opened. Anything else (file:, javascript:, custom schemes) is refused. */
function safeUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const u = new URL(value.trim());
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch { return null; }
}

/** Looks through texts in priority order. A known meeting service wins over any random link. */
function findMeetingLink(texts) {
  const list = texts.filter((t) => typeof t === 'string' && t.length);
  for (const text of list) {
    for (const p of PROVIDERS) {
      const m = text.match(p.re);
      if (m) { const url = safeUrl(tidy(m[0])); if (url) return { url, provider: p.name }; }
    }
  }
  return null;
}

/** For a link someone typed in themselves: any web link is fine. */
function describeLink(value) {
  const url = safeUrl(value);
  if (!url) return null;
  const known = findMeetingLink([url]);
  return { url, provider: known ? known.provider : new URL(url).hostname.replace(/^www\./, '') };
}

module.exports = { findMeetingLink, describeLink, safeUrl, tidy, ANY_URL };
