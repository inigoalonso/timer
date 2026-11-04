'use strict';
function parseDisplayLink(value, origin) {
  let url;
  try { url = new URL(value); } catch { throw Error('Enter a complete display link.'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.origin !== origin || url.username || url.password || url.search ||
      !/^\/display\/[A-Za-z0-9_-]{1,100}$/.test(url.pathname) || !/^#[A-Za-z0-9_-]{20,200}$/.test(url.hash)) {
    throw Error('Use a display link from this Stage time website, not a controller link.');
  }
  return url.href;
}