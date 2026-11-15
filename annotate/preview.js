import { getShot } from '../lib/db.js';
import { fmtClock } from '../lib/steps.js';

const id = Number(new URLSearchParams(location.search).get('shot'));
const video = document.getElementById('video');
const shot = await getShot(id);
if (!shot) {
  document.getElementById('meta').textContent = 'This recording no longer exists.';
} else {
  const url = URL.createObjectURL(shot.blob);
  video.src = url;
  document.getElementById('meta').textContent = `${fmtClock(shot.duration || 0)} · ${(shot.blob.size / 1024 / 1024).toFixed(1)} MB`;
  const ol = document.getElementById('steps');
  for (const s of shot.steps || []) {
    const li = document.createElement('li');
    li.textContent = s.text;
    const t = document.createElement('span');
    t.className = 't';
    t.textContent = fmtClock(s.at);
    li.appendChild(t);
    li.addEventListener('click', () => {
      video.currentTime = Math.max(0, (s.at || 0) - 1);
      video.play();
    });
    ol.appendChild(li);
  }
  document.getElementById('download').addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = url;
    a.download = `recording-${id}.webm`;
    a.click();
  });
}
document.getElementById('close').addEventListener('click', () => window.close());
