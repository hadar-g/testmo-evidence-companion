// Allow-list HTML sanitizer for rich text coming back from Testmo (case steps,
// descriptions, result notes). Scripts, event handlers, javascript: URLs and
// unknown tags are dropped; text content is kept.

const ALLOWED = new Set([
  'p', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'code', 'pre', 'ul', 'ol', 'li',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'a', 'img', 'span', 'div', 'hr', 'sub', 'sup', 'mark',
]);
const ALLOWED_ATTR = {
  a: ['href', 'title'],
  img: ['src', 'alt', 'title', 'width', 'height'],
  td: ['colspan', 'rowspan'],
  th: ['colspan', 'rowspan'],
  code: ['class'],
  pre: ['class'],
};

// Returns { url, relative } for acceptable URLs, or null. Protocol-relative
// URLs are external links, not paths on the Testmo instance.
function safeUrl(value, { allowData = false } = {}) {
  const v = String(value || '').trim();
  if (/^https?:\/\//i.test(v)) return { url: v, relative: false };
  if (v.startsWith('//')) return { url: 'https:' + v, relative: false };
  if (v.startsWith('/') || v.startsWith('#')) return { url: v, relative: v.startsWith('/') };
  if (allowData && /^data:image\/(png|jpeg|gif|webp);base64,/i.test(v)) return { url: v, relative: false };
  return null;
}

const DROP = new Set(['script', 'style', 'iframe', 'object', 'embed', 'template', 'noscript']);

// Images may only come from the Testmo instance itself (or inline data:), so a
// case author cannot plant a tracking pixel that fires when a tester opens it.
function imageAllowed(u, baseUrl) {
  if (u.relative) return true;
  if (u.url.startsWith('data:')) return true;
  return Boolean(baseUrl) && u.url.startsWith(baseUrl + '/');
}

export function sanitizeHtml(html, { baseUrl = '' } = {}) {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const walk = (node) => {
    let child = node.firstChild;
    while (child) {
      const next = child.nextSibling;
      if (child.nodeType === Node.TEXT_NODE) {
        child = next;
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) {
        child.remove();
        child = next;
        continue;
      }
      const tag = child.tagName.toLowerCase();
      if (!ALLOWED.has(tag)) {
        if (DROP.has(tag)) {
          child.remove();
          child = next;
          continue;
        }
        // Keep the text of unknown elements but drop the element itself; the
        // unwrapped children are visited next because they now precede `next`.
        const first = child.firstChild;
        const frag = doc.createDocumentFragment();
        while (child.firstChild) frag.appendChild(child.firstChild);
        child.replaceWith(frag);
        child = first || next;
        continue;
      }
      for (const attr of [...child.attributes]) {
        const name = attr.name.toLowerCase();
        const ok = (ALLOWED_ATTR[tag] || []).includes(name);
        if (!ok) {
          child.removeAttribute(attr.name);
          continue;
        }
        if (name === 'href') {
          const u = safeUrl(attr.value);
          if (!u) child.removeAttribute(attr.name);
          else {
            child.setAttribute('href', u.relative && baseUrl ? baseUrl + u.url : u.url);
            child.setAttribute('target', '_blank');
            child.setAttribute('rel', 'noopener noreferrer');
          }
        }
        if (name === 'src') {
          const u = safeUrl(attr.value, { allowData: true });
          if (!u || !imageAllowed(u, baseUrl)) child.removeAttribute(attr.name);
          else child.setAttribute('src', u.relative && baseUrl ? baseUrl + u.url : u.url);
        }
        if (name === 'class' && !/^(editor-gherkin|language-[a-z0-9-]+|code-block)(\s+(editor-gherkin|language-[a-z0-9-]+|code-block))*$/.test(attr.value)) {
          child.removeAttribute('class');
        }
      }
      walk(child);
      child = next;
    }
  };
  walk(doc.body);
  return doc.body.innerHTML;
}

export function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Plain-text notes typed by the tester become simple paragraphs.
export function textToHtml(text) {
  const t = String(text || '').trim();
  if (!t) return '';
  return t
    .split(/\n{2,}/)
    .map((para) => `<p>${escapeHtml(para).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

export function stripHtml(html) {
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
}
