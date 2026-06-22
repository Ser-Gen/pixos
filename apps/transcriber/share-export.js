/**
 * Экспорт разметки в один HTML-файл для статического хостинга.
 * Аудио подключается по URL (рядом с файлом) или через выбор файла в браузере.
 */

function computePeaks(channelData, targetPoints = 2048) {
  const len = channelData.length;
  const block = Math.max(1, Math.floor(len / targetPoints));
  const peaks = new Float32Array(targetPoints);
  for (let i = 0; i < targetPoints; i++) {
    const start = i * block;
    const end = Math.min(start + block, len);
    let max = 0;
    for (let j = start; j < end; j++) {
      const v = Math.abs(channelData[j]);
      if (v > max) {
        max = v;
      }
    }
    peaks[i] = max;
  }
  return peaks;
}

export function buildSharePayload({ model, audioBuffer, title = 'Transcript', audioUrl = '' }) {
  const snap = model.snapshot();
  let peaks = [];
  let duration = 0;
  if (audioBuffer) {
    duration = audioBuffer.duration;
    peaks = Array.from(computePeaks(audioBuffer.getChannelData(0)));
  }
  return {
    version: 1,
    title,
    audioUrl: audioUrl || '',
    duration,
    peaks,
    speakers: snap.speakers.map((s) => ({ id: s.id, label: s.label, color: s.color })),
    segments: snap.segments.map((s) => ({
      id: s.id,
      start: s.start,
      end: s.end,
      text: s.text,
      speakerId: s.speakerId,
    })),
  };
}

export function renderShareHtml(payload) {
  const dataJson = JSON.stringify(payload).replace(/</g, '\\u003c');
  const title = escapeHtml(payload.title || 'Transcript');
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>${SHARE_PLAYER_CSS}</style>
</head>
<body>
  <div class="share-app">
    <header class="share-header">
      <h1 class="share-title">${title}</h1>
      <p class="share-hint">Положите этот HTML и аудио на хостинг в одну папку или выберите файл локально.</p>
      <div class="share-audio-row">
        <label class="share-label">URL аудио
          <input type="text" id="audioUrl" class="share-input" placeholder="recording.wav или https://…" spellcheck="false" />
        </label>
        <button type="button" id="loadUrlBtn" class="share-btn">Загрузить URL</button>
        <label class="share-btn share-btn--file">
          Файл с компьютера
          <input type="file" id="audioFile" accept="audio/*,video/*" hidden />
        </label>
      </div>
      <p id="audioStatus" class="share-status">Аудио не загружено</p>
      <div class="share-transport">
        <button type="button" id="playBtn" class="share-btn" disabled>▶</button>
        <span id="transportTime" class="share-time">0:00.000</span>
      </div>
    </header>
    <div id="waveformWrap" class="share-waveform-wrap">
      <canvas id="waveform" class="share-waveform"></canvas>
    </div>
    <div id="subtitleBox" class="share-subtitle" aria-live="polite">
      <span id="subtitleSpeaker" class="share-subtitle-speaker"></span>
      <p id="subtitleText" class="share-subtitle-text">Загрузите аудио для воспроизведения</p>
    </div>
    <details class="share-segments">
      <summary>Все сегменты (<span id="segmentCount">0</span>)</summary>
      <div id="segmentList" class="share-segment-list"></div>
    </details>
  </div>
  <script type="application/json" id="transcript-data">${dataJson}</script>
  <script>${SHARE_PLAYER_SCRIPT}</script>
</body>
</html>`;
}

export function downloadShareHtml(payload, filename = 'transcript.html') {
  const html = renderShareHtml(payload);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const SHARE_PLAYER_CSS = `
:root {
  color-scheme: dark;
  --bg: #121216;
  --surface: #1e1e24;
  --border: #3a3a44;
  --text: #e4e4e7;
  --muted: #9a9aa3;
  --accent: #6ea8fe;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100vh;
  font-family: system-ui, -apple-system, sans-serif;
  background: var(--bg);
  color: var(--text);
}
.share-app { max-width: 960px; margin: 0 auto; padding: 1rem; }
.share-title { margin: 0 0 0.35rem; font-size: 1.25rem; }
.share-hint { margin: 0 0 0.75rem; font-size: 0.8125rem; color: var(--muted); }
.share-audio-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: flex-end;
}
.share-label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.75rem; color: var(--muted); flex: 1 1 14rem; }
.share-input {
  font: inherit;
  padding: 0.4rem 0.5rem;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  width: 100%;
}
.share-btn {
  background: var(--accent);
  color: #0d1117;
  border: none;
  border-radius: 6px;
  padding: 0.45rem 0.85rem;
  font: inherit;
  font-weight: 500;
  cursor: pointer;
}
.share-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.share-btn--file { background: var(--surface); color: var(--text); border: 1px solid var(--border); display: inline-flex; align-items: center; }
.share-status { font-size: 0.8125rem; color: var(--muted); margin: 0.5rem 0; }
.share-status.error { color: #f87171; }
.share-transport { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.75rem; }
.share-time { font: 0.875rem ui-monospace, Menlo, monospace; color: var(--accent); }
.share-waveform-wrap {
  height: 120px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  overflow: hidden;
  margin-bottom: 1rem;
}
.share-waveform { display: block; width: 100%; height: 100%; cursor: pointer; }
.share-subtitle {
  min-height: 5rem;
  padding: 1rem 1.25rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  margin-bottom: 1rem;
}
.share-subtitle-speaker {
  display: block;
  font-size: 0.75rem;
  color: var(--muted);
  margin-bottom: 0.35rem;
}
.share-subtitle-speaker:empty { display: none; }
.share-subtitle-text { margin: 0; font-size: 1.125rem; line-height: 1.5; }
.share-segments { border-top: 1px solid var(--border); padding-top: 0.5rem; }
.share-segments summary { cursor: pointer; color: var(--muted); font-size: 0.875rem; }
.share-segment-list { max-height: 40vh; overflow-y: auto; margin-top: 0.5rem; }
.share-segment-item {
  padding: 0.5rem 0.65rem;
  border-radius: 6px;
  margin-bottom: 0.25rem;
  font-size: 0.875rem;
  cursor: pointer;
  border: 1px solid transparent;
}
.share-segment-item:hover { background: var(--surface); }
.share-segment-item.active { border-color: var(--accent); background: rgba(110, 168, 254, 0.12); }
.share-segment-meta { font: 0.7rem ui-monospace, Menlo, monospace; color: var(--accent); margin-bottom: 0.2rem; }
`;

const SHARE_PLAYER_SCRIPT = `
(function () {
  'use strict';

  var dataEl = document.getElementById('transcript-data');
  var DATA = JSON.parse(dataEl.textContent);
  dataEl.remove();

  var audioUrlInput = document.getElementById('audioUrl');
  var loadUrlBtn = document.getElementById('loadUrlBtn');
  var audioFileInput = document.getElementById('audioFile');
  var audioStatus = document.getElementById('audioStatus');
  var playBtn = document.getElementById('playBtn');
  var transportTime = document.getElementById('transportTime');
  var waveformWrap = document.getElementById('waveformWrap');
  var canvas = document.getElementById('waveform');
  var ctx = canvas.getContext('2d');
  var subtitleSpeaker = document.getElementById('subtitleSpeaker');
  var subtitleText = document.getElementById('subtitleText');
  var segmentList = document.getElementById('segmentList');
  var segmentCount = document.getElementById('segmentCount');

  var audio = new Audio();
  audio.preload = 'auto';
  var objectUrl = null;
  var duration = DATA.duration || 0;
  var peaks = DATA.peaks && DATA.peaks.length ? Float32Array.from(DATA.peaks) : null;
  var segments = DATA.segments || [];
  var speakers = DATA.speakers || [];
  var speakerMap = {};
  for (var i = 0; i < speakers.length; i++) {
    speakerMap[speakers[i].id] = speakers[i];
  }

  if (DATA.audioUrl) {
    audioUrlInput.value = DATA.audioUrl;
  }
  segmentCount.textContent = String(segments.length);
  buildSegmentList();

  function formatTime(sec) {
    var totalMs = Math.max(0, Math.round(sec * 1000));
    var ms = totalMs % 1000;
    var totalSec = Math.floor(totalMs / 1000);
    var s = totalSec % 60;
    var m = Math.floor(totalSec / 60) % 60;
    var h = Math.floor(totalSec / 3600);
    var pad = function (n, w) { return String(n).padStart(w, '0'); };
    return (h > 0 ? pad(h, 2) + ':' : '') + pad(m, 2) + ':' + pad(s, 2) + '.' + pad(ms, 3);
  }

  function setStatus(msg, isError) {
    audioStatus.textContent = msg;
    audioStatus.className = 'share-status' + (isError ? ' error' : '');
  }

  function findSegmentAt(t) {
    for (var j = 0; j < segments.length; j++) {
      var seg = segments[j];
      if (t >= seg.start && t <= seg.end) return seg;
    }
    return null;
  }

  function buildSegmentList() {
    segmentList.innerHTML = '';
    for (var k = 0; k < segments.length; k++) {
      (function (seg) {
        var item = document.createElement('div');
        item.className = 'share-segment-item';
        item.dataset.id = seg.id;
        var sp = speakerMap[seg.speakerId];
        var meta = document.createElement('div');
        meta.className = 'share-segment-meta';
        meta.textContent = formatTime(seg.start) + ' – ' + formatTime(seg.end) + (sp ? ' · ' + sp.label : '');
        var text = document.createElement('div');
        text.textContent = seg.text || '';
        item.appendChild(meta);
        item.appendChild(text);
        item.addEventListener('click', function () {
          audio.currentTime = seg.start;
          audio.play().catch(function () {});
        });
        segmentList.appendChild(item);
      })(segments[k]);
    }
  }

  function updateSubtitle() {
    var t = audio.currentTime;
    transportTime.textContent = formatTime(t) + ' / ' + formatTime(duration || 0);
    var seg = findSegmentAt(t);
    var activeId = seg ? seg.id : null;
    if (seg) {
      var sp = speakerMap[seg.speakerId];
      subtitleSpeaker.textContent = sp && speakers.length > 1 ? sp.label : '';
      subtitleText.textContent = seg.text || '';
    } else {
      subtitleSpeaker.textContent = '';
      subtitleText.textContent = '';
    }
    var items = segmentList.querySelectorAll('.share-segment-item');
    for (var n = 0; n < items.length; n++) {
      items[n].classList.toggle('active', items[n].dataset.id === activeId);
    }
    draw();
  }

  function computePeaksFromBuffer(buffer, targetPoints) {
    var channel = buffer.getChannelData(0);
    var len = channel.length;
    var block = Math.max(1, Math.floor(len / targetPoints));
    var out = new Float32Array(targetPoints);
    for (var i = 0; i < targetPoints; i++) {
      var start = i * block;
      var end = Math.min(start + block, len);
      var max = 0;
      for (var j = start; j < end; j++) {
        var v = Math.abs(channel[j]);
        if (v > max) max = v;
      }
      out[i] = max;
    }
    return out;
  }

  async function decodeBlob(blob) {
    var ac = new AudioContext();
    try {
      var buf = await ac.decodeAudioData(await blob.arrayBuffer());
      await ac.close();
      return buf;
    } catch (e) {
      await ac.close();
      throw e;
    }
  }

  function revokeObjectUrl() {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
  }

  function setAudioFromBlob(blob) {
    revokeObjectUrl();
    objectUrl = URL.createObjectURL(blob);
    audio.src = objectUrl;
    playBtn.disabled = false;
  }

  function waitForAudioReady() {
    return new Promise(function (resolve, reject) {
      if (audio.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        resolve();
        return;
      }
      function cleanup() {
        audio.removeEventListener('canplay', onReady);
        audio.removeEventListener('error', onError);
      }
      function onReady() {
        cleanup();
        resolve();
      }
      function onError() {
        cleanup();
        reject(new Error('Аудио не воспроизводится'));
      }
      audio.addEventListener('canplay', onReady);
      audio.addEventListener('error', onError);
    });
  }

  async function applyDecodedBuffer(buf) {
    duration = buf.duration;
    peaks = computePeaksFromBuffer(buf, 2048);
    draw();
    updateSubtitle();
  }

  async function loadFromBlob(blob, label) {
    setStatus('Декодирование…');
    try {
      var buf = await decodeBlob(blob);
      setAudioFromBlob(blob);
      await applyDecodedBuffer(buf);
      await waitForAudioReady();
      setStatus('Загружено: ' + label);
      await audio.play();
    } catch (err) {
      setStatus('Ошибка: ' + err.message, true);
    }
  }

  async function loadFromUrl(url) {
    var trimmed = (url || '').trim();
    if (!trimmed) {
      setStatus('Укажите URL или имя файла', true);
      return;
    }
    setStatus('Загрузка…');
    try {
      var res = await fetch(trimmed);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var blob = await res.blob();
      await loadFromBlob(blob, trimmed);
    } catch (err) {
      setStatus('Не удалось загрузить: ' + err.message + '. Положите аудио рядом с HTML или выберите файл.', true);
    }
  }

  function timeToX(timeSec, w) {
    if (!duration) return 0;
    return (timeSec / duration) * w;
  }

  function xToTime(x, w) {
    if (!duration) return 0;
    return Math.max(0, Math.min(duration, (x / w) * duration));
  }

  function draw() {
    var rect = waveformWrap.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    var w = Math.max(1, Math.floor(rect.width));
    var h = Math.max(1, Math.floor(rect.height));
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#1a1a1e';
    ctx.fillRect(0, 0, w, h);
    var mid = h / 2;
    if (peaks && peaks.length) {
      var step = w / peaks.length;
      ctx.fillStyle = '#4a5568';
      for (var i = 0; i < peaks.length; i++) {
        var amp = peaks[i] * (h * 0.42);
        var x = i * step;
        ctx.fillRect(x, mid - amp, Math.max(1, step), amp * 2);
      }
    }
    for (var s = 0; s < segments.length; s++) {
      var seg = segments[s];
      var sp = speakerMap[seg.speakerId];
      var color = (sp && sp.color) || '#6ea8fe';
      var x1 = timeToX(seg.start, w);
      var x2 = timeToX(seg.end, w);
      ctx.fillStyle = color + '33';
      ctx.fillRect(x1, 0, Math.max(1, x2 - x1), h);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.strokeRect(x1, 0, Math.max(1, x2 - x1), h);
    }
    var active = findSegmentAt(audio.currentTime);
    if (active) {
      var ax1 = timeToX(active.start, w);
      var ax2 = timeToX(active.end, w);
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 2;
      ctx.strokeRect(ax1, 0, Math.max(1, ax2 - ax1), h);
    }
    if (duration > 0) {
      var px = timeToX(audio.currentTime, w);
      ctx.strokeStyle = '#f87171';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, h);
      ctx.stroke();
    }
  }

  canvas.addEventListener('click', function (e) {
    if (!duration) return;
    var rect = canvas.getBoundingClientRect();
    var x = e.clientX - rect.left;
    audio.currentTime = xToTime(x, rect.width);
    audio.play().catch(function () {});
    updateSubtitle();
  });

  loadUrlBtn.addEventListener('click', function () {
    loadFromUrl(audioUrlInput.value);
  });
  audioUrlInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') loadFromUrl(audioUrlInput.value);
  });
  audioFileInput.addEventListener('change', function () {
    var file = audioFileInput.files && audioFileInput.files[0];
    if (file) loadFromBlob(file, file.name);
  });

  playBtn.addEventListener('click', function () {
    if (audio.paused) audio.play().catch(function () {});
    else audio.pause();
  });
  audio.addEventListener('play', function () { playBtn.textContent = '⏸'; });
  audio.addEventListener('pause', function () { playBtn.textContent = '▶'; });
  audio.addEventListener('timeupdate', updateSubtitle);
  audio.addEventListener('loadedmetadata', function () {
    if (audio.duration && isFinite(audio.duration)) {
      duration = audio.duration;
      draw();
    }
  });

  new ResizeObserver(function () { draw(); }).observe(waveformWrap);

  if (peaks && peaks.length && duration > 0) {
    draw();
    setStatus('Разметка загружена. Укажите аудио (URL или файл).');
  } else {
    setStatus('Разметка загружена. Укажите аудио (URL или файл).');
  }
})();
`.trim();
