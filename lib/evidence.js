// Image files a tester can attach from disk. SVG is left out: it can carry script.
const IMAGE_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };

export const ATTACH_ACCEPT = Object.keys(IMAGE_TYPES).join(',');

export function isAttachableImage(file) {
  return Boolean(file && IMAGE_TYPES[String(file.type || '').toLowerCase()]);
}

// Split dropped or picked files into ones we can store and the names we reject.
export function partitionFiles(files) {
  const accepted = [];
  const rejected = [];
  for (const f of files || []) (isAttachableImage(f) ? accepted : rejected).push(f);
  return { accepted, rejected: rejected.map((f) => f.name || 'unnamed file') };
}

export function evidenceExtension(shot) {
  if (shot && shot.kind === 'video') return 'webm';
  const type = String((shot && shot.blob && shot.blob.type) || '').toLowerCase();
  return IMAGE_TYPES[type] || 'png';
}

export function evidenceName(caseId, slug, i, shot) {
  const ext = evidenceExtension(shot);
  return shot && shot.kind === 'video' ? `C${caseId}-${slug}-recording-${i + 1}.${ext}` : `C${caseId}-${slug}-${i + 1}.${ext}`;
}
