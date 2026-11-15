export function fmtElapsed(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

export function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

// Colours are interpolated into style attributes, so only accept real hex.
export function statusColor(status) {
  const c = status && status.color ? String(status.color).replace('#', '').trim() : '';
  return /^[0-9a-f]{3}([0-9a-f]{3})?([0-9a-f]{2})?$/i.test(c) ? `#${c}` : '#C8C9CA';
}

export function timestampSlug(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// Names the status and keeps the web-session error, which the REST fallback would otherwise hide.
export function submitFailureMessage(statusName, apiErr, webErr) {
  const api = (apiErr && apiErr.message) || String(apiErr || 'Unknown error');
  const lines = [`Could not save "${statusName || 'result'}". ${api}`];
  if (webErr) lines.push(`Signed-in Testmo submit failed first: ${webErr.message || String(webErr)}`);
  return lines.join('\n');
}
