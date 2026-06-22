import { segmentsToSrt } from './srt.js';
import { mergeVadOptions } from './transcriber-config.js';
import { buildRecognizerWorkerUrl } from './wasm-settings.js';

export { segmentsToSrt, formatSrtTimestamp } from './srt.js';

export class TranscriptionCancelledError extends Error {
  constructor() {
    super('Transcription cancelled');
    this.name = 'TranscriptionCancelledError';
  }
}

const DEFAULT_SAMPLE_RATE = 16000;

export function downsampleBuffer(buffer, inputSampleRate, outputSampleRate) {
  if (inputSampleRate === outputSampleRate) {
    return buffer;
  }

  const sampleRateRatio = inputSampleRate / outputSampleRate;
  const newLength = Math.round(buffer.length / sampleRateRatio);
  const result = new Float32Array(newLength);

  let offsetResult = 0;
  let offsetBuffer = 0;

  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio);
    let accum = 0;
    let count = 0;

    for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
      accum += buffer[i];
      count++;
    }

    result[offsetResult] = count > 0 ? accum / count : 0;
    offsetResult++;
    offsetBuffer = nextOffsetBuffer;
  }

  return result;
}

export async function decodeAudioBlob(blob, sampleRate = DEFAULT_SAMPLE_RATE) {
  const arrayBuffer = await blob.arrayBuffer();
  const audioCtx = new AudioContext();
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

  let samples = audioBuffer.getChannelData(0);
  if (audioBuffer.numberOfChannels > 1) {
    const ch1 = audioBuffer.getChannelData(0);
    const ch2 = audioBuffer.getChannelData(1);
    samples = new Float32Array(ch1.length);
    for (let i = 0; i < ch1.length; i++) {
      samples[i] = (ch1[i] + ch2[i]) / 2;
    }
  }

  await audioCtx.close();
  return downsampleBuffer(samples, audioBuffer.sampleRate, sampleRate);
}

export class GigaamTranscriber extends EventTarget {
  constructor(options = {}) {
    super();

    this.sampleRate = options.sampleRate ?? DEFAULT_SAMPLE_RATE;
    this.vadProfile = options.vadProfile;
    this.vadOptions = options.vadOptions ?? null;
    this._isReady = false;
    this._decodeRequestId = 0;
    this._pendingDecodes = new Map();
    this._liveSession = null;
    this._batchCancelled = false;
    this._lastStatusText = '';
    this.onStatus = typeof options.onStatus === 'function' ? options.onStatus : null;

    let readyResolve;
    let readyReject;
    this.ready = new Promise((resolve, reject) => {
      readyResolve = resolve;
      readyReject = reject;
    });
    this._readyResolve = readyResolve;
    this._readyReject = readyReject;

    const workerBase =
      options.workerUrl ?? new URL('./recognizer-worker.js', import.meta.url);
    const workerHref = buildRecognizerWorkerUrl(workerBase);
    this.worker = new Worker(workerHref, { type: 'classic' });

    this.worker.onmessage = (event) => this._handleWorkerMessage(event.data);
    this.worker.onerror = (event) => {
      const error = new Error(event.message || 'Worker error');
      this.dispatchEvent(new ErrorEvent('error', { error, message: error.message }));
    };
  }

  get lastStatusText() {
    return this._lastStatusText;
  }

  get isReady() {
    return this._isReady;
  }

  get isLive() {
    return this._liveSession != null;
  }

  get isBusy() {
    return this._pendingDecodes.size > 0 || this.isLive;
  }

  getVadOptions() {
    return this.vadOptions ? { ...this.vadOptions } : null;
  }

  setVadOptions(vadOptions) {
    this.vadOptions = vadOptions ? { ...vadOptions } : null;
  }

  _resolveVadPayload(source, options = {}) {
    const vadProfile = options.vadProfile ?? this.vadProfile;
    const overrides = options.vad ?? this.vadOptions;
    if (!overrides && vadProfile == null) {
      return { vadProfile: undefined, vad: undefined };
    }
    return {
      vadProfile,
      vad: mergeVadOptions(source, vadProfile, overrides || {}),
    };
  }

  _sessionSource(msgId) {
    if (this._liveSession?.id === msgId) {
      return this._liveSession;
    }
    return this._pendingDecodes.get(msgId);
  }

  _emitSegment(msg) {
    const session = this._sessionSource(msg.id);
    if (!session) {
      return;
    }

    const segments = msg.segments || [];
    const text = (msg.text || '').trim();
    this.dispatchEvent(
      new CustomEvent('transcribe-segment', {
        detail: {
          segment: msg.segment,
          segments,
          text,
          srt: segmentsToSrt(segments),
          source: session.source,
          startedAt: session.startedAt,
          live: this._liveSession?.id === msg.id,
        },
      }),
    );
  }

  _finishSession(msg, errorMessage) {
    const live = this._liveSession?.id === msg.id ? this._liveSession : null;
    const pending = this._pendingDecodes.get(msg.id);

    if (!live && !pending) {
      return;
    }

    const startedAt = (live ?? pending).startedAt;
    const source = (live ?? pending).source;
    const finishedAt = new Date();
    const durationMs = finishedAt - startedAt;

    if (live) {
      this._liveSession = null;
    } else {
      this._pendingDecodes.delete(msg.id);
    }

    if (errorMessage) {
      const error = new Error(errorMessage);
      pending?.reject(error);
      live?.stopReject?.(error);
      this.dispatchEvent(
        new CustomEvent('transcribe-error', {
          detail: { error, source, startedAt, finishedAt, durationMs },
        }),
      );
      return;
    }

    const segments = msg.segments || [];
    const result = {
      text: (msg.text || '').trim(),
      segments,
      srt: segmentsToSrt(segments),
      stats: msg.stats ?? null,
      source,
      startedAt,
      finishedAt,
      durationMs,
      live: Boolean(live),
      cancelled: Boolean(msg.cancelled),
    };

    pending?.resolve(result);
    live?.stopResolve?.(result);
    this.dispatchEvent(new CustomEvent('transcribe-end', { detail: result }));
  }

  _handleWorkerMessage(msg) {
    if (msg.type === 'status') {
      const text = typeof msg.text === 'string' ? msg.text : '';
      this._lastStatusText = text;
      this.onStatus?.(text);
      this.dispatchEvent(new CustomEvent('status', { detail: { text } }));
      return;
    }

    if (msg.type === 'ready') {
      this._isReady = true;
      this._readyResolve();
      this.dispatchEvent(new Event('ready'));
      return;
    }

    if (msg.type === 'init-error') {
      const error = new Error(msg.message);
      this._readyReject(error);
      this.dispatchEvent(new ErrorEvent('error', { error, message: msg.message }));
      return;
    }

    if (msg.type === 'segment-done') {
      this._emitSegment(msg);
      return;
    }

    if (msg.type === 'live-started') {
      return;
    }

    if (msg.type === 'live-error') {
      this._finishSession(msg, msg.message);
      return;
    }

    if (msg.type === 'live-done') {
      this._finishSession(msg);
      return;
    }

    if (msg.type === 'decode-done') {
      this._finishSession(msg);
      return;
    }

    if (msg.type === 'decode-error') {
      this._finishSession(msg, msg.message);
    }
  }

  _assertIdleForLive() {
    if (this._liveSession) {
      throw new Error('Live session already active');
    }
    if (this._pendingDecodes.size > 0) {
      throw new Error('Transcriber is busy');
    }
  }

  _assertIdleForBatch() {
    if (this._liveSession) {
      throw new Error('Stop live session first');
    }
  }

  startLive(options = {}) {
    if (!this._isReady) {
      throw new Error('Transcriber is not ready');
    }
    this._assertIdleForLive();

    const source = options.source ?? 'live: микрофон';
    const startedAt = new Date();
    const id = ++this._decodeRequestId;

    this._liveSession = {
      id,
      source,
      startedAt,
      stopResolve: null,
      stopReject: null,
    };

    this.dispatchEvent(
      new CustomEvent('transcribe-start', { detail: { source, startedAt, live: true } }),
    );

    const { vadProfile, vad } = this._resolveVadPayload(source, options);

    this.worker.postMessage({
      type: 'live-start',
      id,
      source,
      vadProfile,
      vad,
    });
  }

  feedLiveAudio(samples) {
    if (!this._liveSession) {
      return;
    }

    const chunk = samples instanceof Float32Array ? samples : new Float32Array(samples);
    const copy = new Float32Array(chunk);
    this.worker.postMessage(
      {
        type: 'live-audio',
        id: this._liveSession.id,
        samples: copy,
      },
      [copy.buffer],
    );
  }

  stopLive() {
    if (!this._liveSession) {
      return Promise.resolve(null);
    }

    const { id } = this._liveSession;

    return new Promise((resolve, reject) => {
      this._liveSession.stopResolve = resolve;
      this._liveSession.stopReject = reject;
      this.worker.postMessage({ type: 'live-stop', id });
    });
  }

  cancelBatch() {
    this._batchCancelled = true;
    for (const id of this._pendingDecodes.keys()) {
      this.worker.postMessage({ type: 'decode-cancel', id });
    }
  }

  cancel() {
    if (this._liveSession) {
      return this.stopLive();
    }
    this.cancelBatch();
    return Promise.resolve(null);
  }

  async transcribe(blob, options = {}) {
    if (!this._isReady) {
      await this.ready;
    }
    this._assertIdleForBatch();

    this._batchCancelled = false;
    const source = options.source ?? 'audio';
    const { vadProfile, vad } = this._resolveVadPayload(source, options);
    const startedAt = new Date();
    const id = ++this._decodeRequestId;

    const resultPromise = new Promise((resolve, reject) => {
      this._pendingDecodes.set(id, { resolve, reject, source, startedAt });
    });

    this.dispatchEvent(
      new CustomEvent('transcribe-start', { detail: { source, startedAt, live: false } }),
    );

    try {
      const samples = await decodeAudioBlob(blob, this.sampleRate);

      if (this._batchCancelled) {
        this._pendingDecodes.delete(id);
        throw new TranscriptionCancelledError();
      }

      this.worker.postMessage(
        {
          type: 'decode',
          id,
          samples,
          sampleRate: this.sampleRate,
          source,
          vadProfile,
          vad,
        },
        [samples.buffer],
      );
    } catch (err) {
      if (this._pendingDecodes.has(id)) {
        this._pendingDecodes.delete(id);
      }
      throw err;
    }

    return resultPromise;
  }

  terminate() {
    this.worker.terminate();
    this._isReady = false;
    this._liveSession = null;

    for (const pending of this._pendingDecodes.values()) {
      pending.reject(new Error('Transcriber terminated'));
    }
    this._pendingDecodes.clear();
  }
}

export default GigaamTranscriber;
