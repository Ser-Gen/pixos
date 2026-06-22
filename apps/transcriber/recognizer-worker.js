var Module = typeof Module !== 'undefined' ? Module : {};

let recognizer = null;
let vad = null;
let liveSession = null;
let liveVadBuffer = null;
let liveAsrQueue = [];
let cancelDecodeId = null;

function workerSleep() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function takeDecodeCancel(id) {
  if (id != null && cancelDecodeId === id) {
    cancelDecodeId = null;
    return true;
  }
  return false;
}

const SAMPLE_RATE = 16000;
const VAD_WINDOW_SIZE = 512;
const LIVE_BUFFER_CAPACITY = SAMPLE_RATE * 30;

function resolveVadProfile(source, vadProfile) {
  if (vadProfile === 'microphone' || vadProfile === 'file') {
    return vadProfile;
  }
  if (typeof source === 'string' && /live|микрофон|microphone|mic/i.test(source)) {
    return 'microphone';
  }
  return 'file';
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

const VAD_DEFAULTS = {
  file: {
    threshold: 0.35,
    minSilenceDuration: 0.25,
    minSpeechDuration: 0.25,
    maxSpeechDuration: 5,
    minSegmentRms: 0.008,
  },
  microphone: {
    threshold: 0.55,
    minSilenceDuration: 0.4,
    minSpeechDuration: 0.5,
    maxSpeechDuration: 5,
    minSegmentRms: 0.012,
  },
};

function resolveVadSettings(source, vadProfile, vadOverrides) {
  const profile = resolveVadProfile(source, vadProfile);
  const base = VAD_DEFAULTS[profile];
  const merged = { ...base, ...(vadOverrides || {}) };

  merged.threshold = clamp(merged.threshold, 0.05, 0.95);
  merged.minSilenceDuration = clamp(merged.minSilenceDuration, 0.05, 5);
  merged.minSpeechDuration = clamp(merged.minSpeechDuration, 0.05, 5);
  merged.maxSpeechDuration = clamp(merged.maxSpeechDuration, 1, 30);
  merged.minSegmentRms = clamp(merged.minSegmentRms, 0, 0.1);

  return { profile, minRms: merged.minSegmentRms, silero: merged };
}

function computeRms(samples) {
  if (samples.length === 0) {
    return 0;
  }
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / samples.length);
}

function createVadInstance(vadSettings) {
  const silero = typeof vadSettings === 'string'
    ? VAD_DEFAULTS[vadSettings] || VAD_DEFAULTS.file
    : vadSettings.silero;

  return new Vad(
    {
      sileroVad: {
        model: './silero_vad.onnx',
        windowSize: VAD_WINDOW_SIZE,
        threshold: silero.threshold,
        minSilenceDuration: silero.minSilenceDuration,
        minSpeechDuration: silero.minSpeechDuration,
        maxSpeechDuration: silero.maxSpeechDuration,
      },
      tenVad: {
        model: '',
        threshold: 0.5,
        minSilenceDuration: 0.5,
        minSpeechDuration: 0.25,
        maxSpeechDuration: 20,
        windowSize: 256,
      },
      sampleRate: SAMPLE_RATE,
      numThreads: 1,
      provider: 'cpu',
      debug: 0,
      bufferSizeInSeconds: 100,
    },
    Module,
  );
}

function resolveAssetUrl(configValue, localPath) {
  if (typeof configValue === 'string' && configValue.trim()) {
    return configValue.trim();
  }
  return localPath;
}

Module.locateFile = function (path, scriptDirectory = '') {
  if (path.endsWith('.wasm')) {
    return resolveAssetUrl(WASM_BINARY_URL, './sherpa-onnx-wasm.wasm');
  }
  if (path.endsWith('.data') || path === 'sherpa-onnx-wasm-main-vad-asr.data') {
    return resolveAssetUrl(WASM_DATA_URL, './sherpa-onnx-wasm.data');
  }
  return scriptDirectory + path;
};

Module.setStatus = function (status) {
  if (!status) {
    return;
  }

  if (status === 'Running...') {
    status = 'Модель загружена. Инициализация…';
  } else if (status === 'Downloading data...') {
    status = 'Загрузка модели…';
  }

  const downloadMatch = status.match(/Downloading data\.\.\. \((\d+)\/(\d+)\)/);
  if (downloadMatch) {
    const downloaded = BigInt(downloadMatch[1]);
    const total = BigInt(downloadMatch[2]);
    const percent =
      total === 0n ? 0 : Number((downloaded * 10000n) / total) / 100;
    const downloadedMB = Number(downloaded) / (1024 * 1024);
    const totalMB = Number(total) / (1024 * 1024);
    status =
      `Загрузка модели… ${percent.toFixed(1)}% ` +
      `(${downloadedMB.toFixed(0)} / ${totalMB.toFixed(0)} MB)`;
  }

  self.postMessage({ type: 'status', text: status });
};

function shouldSkipSegmentText(text) {
  const trimmed = (text || '').trim();
  return trimmed === '' || trimmed === '.' || trimmed === 'The.';
}

function speechSegmentFromVad(segSamples, start) {
  const startSec = start / SAMPLE_RATE;
  const durationSec = segSamples.length / SAMPLE_RATE;
  return {
    start: startSec,
    end: startSec + durationSec,
    duration: durationSec,
    samples: segSamples,
  };
}

function recognizeSegment(seg, minRms) {
  if (computeRms(seg.samples) < minRms) {
    return { kind: 'quiet' };
  }

  const stream = recognizer.createStream();
  stream.acceptWaveform(SAMPLE_RATE, seg.samples);
  recognizer.decode(stream);
  const text = (recognizer.getResult(stream).text || '').trim();
  stream.free();

  if (shouldSkipSegmentText(text)) {
    return { kind: 'empty' };
  }

  return {
    kind: 'ok',
    segment: {
      start: seg.start,
      end: seg.end,
      duration: seg.duration,
      text,
    },
  };
}

function emitSegmentDone(session, segment) {
  session.results.push(segment);
  self.postMessage({
    type: 'segment-done',
    id: session.id,
    segment,
    segments: session.results.slice(),
    text: session.results.map((s) => s.text).join(' '),
  });
}

function drainLiveAsrQueue() {
  while (liveAsrQueue.length > 0) {
    const job = liveAsrQueue.shift();
    if (!liveSession || job.sessionId !== liveSession.id) {
      continue;
    }

    const outcome = recognizeSegment(job.seg, liveSession.minRms);
    if (outcome.kind === 'ok') {
      liveSession.asrRuns += 1;
      emitSegmentDone(liveSession, outcome.segment);
    } else if (outcome.kind === 'quiet') {
      liveSession.skippedQuiet += 1;
    } else if (outcome.kind === 'empty') {
      liveSession.skippedEmpty += 1;
    }
  }
}

function enqueueLiveSegment(seg) {
  if (!liveSession) {
    return;
  }
  liveSession.vadSegments += 1;
  liveAsrQueue.push({ sessionId: liveSession.id, seg });
  drainLiveAsrQueue();
}

function collectReadyVadSegments() {
  while (vad && !vad.isEmpty()) {
    const { samples: segSamples, start } = vad.front();
    vad.pop();
    enqueueLiveSegment(speechSegmentFromVad(segSamples, start));
  }
}

function feedVad(samples) {
  let offset = 0;
  while (offset + VAD_WINDOW_SIZE <= samples.length) {
    vad.acceptWaveform(samples.subarray(offset, offset + VAD_WINDOW_SIZE));
    offset += VAD_WINDOW_SIZE;
  }
  if (offset < samples.length) {
    vad.acceptWaveform(samples.subarray(offset));
  }
}

function feedVadAndCollect(samples) {
  feedVad(samples);
  collectReadyVadSegments();
}

function feedLiveAudioChunk(samples) {
  if (!liveSession || !liveVadBuffer) {
    return;
  }

  liveSession.samplesReceived += samples.length;
  liveVadBuffer.push(samples);

  while (liveVadBuffer.size() > VAD_WINDOW_SIZE) {
    const window = liveVadBuffer.get(liveVadBuffer.head(), VAD_WINDOW_SIZE);
    vad.acceptWaveform(window);
    liveVadBuffer.pop(VAD_WINDOW_SIZE);
    collectReadyVadSegments();
  }
}

function teardownLiveSession() {
  if (liveVadBuffer) {
    liveVadBuffer.free();
    liveVadBuffer = null;
  }
  if (vad) {
    vad.reset();
  }
  liveAsrQueue = [];
  liveSession = null;
}

function handleLiveStart(data) {
  if (liveSession) {
    self.postMessage({
      type: 'live-error',
      id: data.id,
      message: 'Live session already active',
    });
    return;
  }

  const vadSettings = resolveVadSettings(data.source, data.vadProfile || 'microphone', data.vad);

  if (vad) {
    vad.free();
  }
  vad = createVadInstance(vadSettings);

  liveVadBuffer = new CircularBuffer(LIVE_BUFFER_CAPACITY, Module);
  liveSession = {
    id: data.id,
    vadProfile: vadSettings.profile,
    minRms: vadSettings.minRms,
    results: [],
    samplesReceived: 0,
    vadSegments: 0,
    skippedQuiet: 0,
    skippedEmpty: 0,
    asrRuns: 0,
  };
  liveAsrQueue = [];

  self.postMessage({ type: 'live-started', id: data.id });
}

function handleLiveStop(data) {
  if (!liveSession || liveSession.id !== data.id) {
    self.postMessage({
      type: 'live-error',
      id: data.id,
      message: 'Live session not found',
    });
    return;
  }

  const session = liveSession;

  if (liveVadBuffer && liveVadBuffer.size() > 0) {
    const tail = liveVadBuffer.get(liveVadBuffer.head(), liveVadBuffer.size());
    liveVadBuffer.pop(liveVadBuffer.size());
    feedVadAndCollect(tail);
  }

  vad.flush();
  collectReadyVadSegments();
  drainLiveAsrQueue();

  const segments = session.results.slice();
  const text = segments.map((s) => s.text).join(' ');
  const stats = {
    vadProfile: session.vadProfile,
    audioDurationSec: session.samplesReceived / SAMPLE_RATE,
    vadSegments: session.vadSegments,
    skippedQuiet: session.skippedQuiet,
    skippedEmpty: session.skippedEmpty,
    asrRuns: session.asrRuns,
    live: true,
  };

  teardownLiveSession();

  self.postMessage({
    type: 'live-done',
    id: data.id,
    text,
    segments,
    stats,
  });
}

async function transcribeWithVadAsync(samples, sampleRate, options) {
  const vadSettings = resolveVadSettings(options.source, options.vadProfile, options.vad);
  const { profile: vadProfile, minRms } = vadSettings;

  if (vad) {
    vad.free();
  }
  vad = createVadInstance(vadSettings);

  feedVad(samples);
  vad.flush();

  const speechSegments = [];
  while (!vad.isEmpty()) {
    const { samples: segSamples, start } = vad.front();
    vad.pop();
    speechSegments.push(speechSegmentFromVad(segSamples, start));
  }

  const total = speechSegments.length;
  let skippedQuiet = 0;
  let skippedEmpty = 0;
  let asrRuns = 0;

  self.postMessage({
    type: 'status',
    text:
      total === 0
        ? `VAD (${vadProfile}): речь не обнаружена`
        : `VAD (${vadProfile}): ${total} сегм. → распознавание…`,
  });

  await workerSleep();
  if (takeDecodeCancel(options.id)) {
    vad.reset();
    return buildTranscribeResult([], {
      vadProfile,
      vadSettings,
      samples,
      sampleRate,
      total,
      skippedQuiet,
      skippedEmpty,
      asrRuns,
      cancelled: true,
    });
  }

  const results = [];
  let cancelled = false;
  for (let i = 0; i < speechSegments.length; i++) {
    if (takeDecodeCancel(options.id)) {
      cancelled = true;
      break;
    }

    await workerSleep();
    if (takeDecodeCancel(options.id)) {
      cancelled = true;
      break;
    }

    const seg = speechSegments[i];
    const outcome = recognizeSegment(seg, minRms);

    if (outcome.kind === 'quiet') {
      skippedQuiet += 1;
      continue;
    }
    if (outcome.kind === 'empty') {
      skippedEmpty += 1;
      continue;
    }

    asrRuns += 1;
    self.postMessage({
      type: 'status',
      text: `Распознавание: сегмент ${asrRuns} / ${total - skippedQuiet}`,
    });

    results.push(outcome.segment);

    if (options.id != null) {
      self.postMessage({
        type: 'segment-done',
        id: options.id,
        segment: outcome.segment,
        segments: results.slice(),
        text: results.map((s) => s.text).join(' '),
      });
    }
  }

  vad.reset();

  return buildTranscribeResult(results, {
    vadProfile,
    vadSettings,
    samples,
    sampleRate,
    total,
    skippedQuiet,
    skippedEmpty,
    asrRuns,
    cancelled,
  });
}

function buildTranscribeResult(segments, ctx) {
  return {
    segments,
    stats: {
      vadProfile: ctx.vadProfile,
      vad: {
        threshold: ctx.vadSettings.silero.threshold,
        minSilenceDuration: ctx.vadSettings.silero.minSilenceDuration,
        minSpeechDuration: ctx.vadSettings.silero.minSpeechDuration,
        maxSpeechDuration: ctx.vadSettings.silero.maxSpeechDuration,
        minSegmentRms: ctx.vadSettings.minRms,
      },
      audioDurationSec: ctx.samples.length / ctx.sampleRate,
      vadSegments: ctx.total,
      skippedQuiet: ctx.skippedQuiet,
      skippedEmpty: ctx.skippedEmpty,
      asrRuns: ctx.asrRuns,
      cancelled: ctx.cancelled,
    },
    cancelled: ctx.cancelled,
  };
}

Module.onRuntimeInitialized = function () {
  try {
    vad = createVadInstance('file');
    recognizer = new OfflineRecognizer(
      {
        modelConfig: {
          transducer: {
            encoder: './nemo-transducer-encoder.onnx',
            decoder: './nemo-transducer-decoder.onnx',
            joiner: './nemo-transducer-joiner.onnx',
          },
          tokens: './tokens.txt',
          modelType: 'nemo_transducer',
          numThreads: 1,
        },
      },
      Module,
    );
    self.postMessage({ type: 'ready' });
  } catch (err) {
    self.postMessage({ type: 'init-error', message: err.message });
  }
};

self.onmessage = function (event) {
  const data = event.data;

  if (data.type === 'live-start') {
    handleLiveStart(data);
    return;
  }

  if (data.type === 'live-audio') {
    if (!liveSession || liveSession.id !== data.id) {
      return;
    }
    feedLiveAudioChunk(data.samples);
    return;
  }

  if (data.type === 'live-stop') {
    handleLiveStop(data);
    return;
  }

  if (data.type === 'decode-cancel') {
    cancelDecodeId = data.id;
    return;
  }

  if (data.type !== 'decode') {
    return;
  }

  if (liveSession) {
    self.postMessage({
      type: 'decode-error',
      id: data.id,
      message: 'Active live session',
    });
    return;
  }

  const { id, samples, sampleRate, source, vadProfile, vad } = data;
  void runBatchDecode({ id, samples, sampleRate, source, vadProfile, vad });
};

async function runBatchDecode(data) {
  const { id, samples, sampleRate, source, vadProfile, vad } = data;

  try {
    const { segments, stats, cancelled } = await transcribeWithVadAsync(samples, sampleRate, {
      source,
      vadProfile,
      vad,
      id,
    });
    const text = segments.map((s) => s.text).join(' ');
    self.postMessage({ type: 'decode-done', id, text, segments, stats, cancelled: Boolean(cancelled) });
  } catch (err) {
    self.postMessage({ type: 'decode-error', id, message: err.message });
  }
}

function applyWasmAssetOverrides(wasmBinaryUrl, wasmDataUrl) {
  if (typeof wasmBinaryUrl === 'string' && wasmBinaryUrl.trim()) {
    WASM_BINARY_URL = wasmBinaryUrl.trim();
  }
  if (typeof wasmDataUrl === 'string' && wasmDataUrl.trim()) {
    WASM_DATA_URL = wasmDataUrl.trim();
  }
}

function syncWasmUrlsFromStorage() {
  if (typeof localStorage === 'undefined') {
    return;
  }
  try {
    const raw = localStorage.getItem('gigaam-wasm-asset-urls');
    if (!raw) {
      return;
    }
    const parsed = JSON.parse(raw);
    applyWasmAssetOverrides(parsed.wasmBinaryUrl, parsed.wasmDataUrl);
  } catch (err) {
    console.warn('[recognizer-worker] wasm URL from storage:', err);
  }
}

function syncWasmUrlsFromWorkerSearch() {
  try {
    const params = new URL(self.location.href).searchParams;
    applyWasmAssetOverrides(
      params.get('wasm') || params.get('wasmUrl') || params.get('wasmBinaryUrl'),
      params.get('data') || params.get('wasmData') || params.get('wasmDataUrl'),
    );
  } catch (err) {
    console.warn('[recognizer-worker] wasm URL from worker search:', err);
  }
}

importScripts('./wasm-assets-config.js');
syncWasmUrlsFromStorage();
syncWasmUrlsFromWorkerSearch();
importScripts('./sherpa-onnx-asr.js', './sherpa-onnx-vad.js', './sherpa-onnx-wasm.js');
