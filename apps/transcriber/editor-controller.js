import GigaamTranscriber, {
  decodeAudioBlob,
  downsampleBuffer,
  TranscriptionCancelledError,
} from './gigaam-transcriber.js';
import { getDefaultVadOptions, resolveVadProfile } from './transcriber-config.js';
import {
  loadWasmAssetUrls,
  saveWasmAssetUrls,
  applyWasmAssetUrls,
  initWasmAssetUrls,
} from './wasm-settings.js';
import {
  loadAudioUrl,
  saveAudioUrl,
  fetchAudioFromUrl,
  fileNameFromAudioUrl,
  parseAudioUrlFromLocation,
  setQueryAudioUrl,
  clearQueryAudioUrl,
} from './audio-url.js';
import { formatDisplayTime } from './srt.js';
import { buildSharePayload, downloadShareHtml } from './share-export.js';
import {
  isServiceWorkerEnvironmentReady,
  waitForServiceWorkerControl,
} from './sw-readiness.js';
import { TranscriptModel } from './transcript-model.js';
import { WaveformView } from './waveform-view.js';
import { SpeakersPanel } from './speakers-panel.js';
import { TranscriptPanel } from './transcript-panel.js';

export class EditorController {
  constructor(refs) {
    this.refs = refs;
    this.model = new TranscriptModel();
    this.transcriber = null;
    this._swReady = false;

    this.previewUrl = null;
    this.currentBlob = null;
    this.audioBuffer = null;
    this.audioSourceLabel = null;
    this.hasTranscript = false;

    this.mediaRecorder = null;
    this.recordedChunks = [];
    this.isRecording = false;
    this.isLiveActive = false;
    this.micStream = null;
    this.liveAudioCtx = null;
    this.liveMicSource = null;
    this.liveProcessor = null;
    this.liveSamples = [];
    this.recordTimerInterval = null;
    this.recordStartedAt = null;
    this.liveStartedAt = null;
    this._transcribingActive = false;
    this._modelLoading = false;

    this.waveform = new WaveformView(refs.waveformContainer, refs.previewEl);
    this.speakersPanel = new SpeakersPanel(refs.speakersPanel, this.model);
    this.transcriptPanel = new TranscriptPanel(refs.transcriptPanel, this.model, {
      onSeek: (t) => this.seekTo(t),
      getPlayhead: () => refs.previewEl.currentTime,
    });

    this._bindWaveform();
    this._bindKeyboard();
    this._bindToolbar();
    this._bindUrlAudio();
    this._bindSettings();
    this._bindAudio();
    this._bindSwWarning();
    this._bindSwDownloadProgress();

    this.model.addEventListener('change', () => this._syncViews());
    this._syncViews();
    this._setUiBusy(true);
    this._bootstrapServiceWorker();
  }

  _syncViews() {
    const snap = this.model.snapshot();
    this._syncPlayhead();
    const transcribing = this.transcriber?.isBusy ?? false;
    this.refs.downloadSrtBtn.disabled =
      !this.hasTranscript || transcribing || !snap.segments.length;
    this.refs.downloadShareHtmlBtn.disabled =
      !this.hasTranscript || transcribing || !snap.segments.length;
  }

  _bindSwWarning() {
    this.refs.swReloadBtn.addEventListener('click', () => {
      window.location.reload();
    });
  }

  _showSwWarning(reason) {
    const { swWarningEl, swWarningTextEl, swReloadBtn } = this.refs;
    swWarningTextEl.textContent = reason.message;
    swWarningEl.hidden = false;
    swReloadBtn.hidden = !reason.canReload;
    this.appendLog(`Service Worker: ${reason.message}`);
  }

  _hideSwWarning() {
    this.refs.swWarningEl.hidden = true;
  }

  async _bootstrapServiceWorker() {
    this.setStatus('Проверка Service Worker…');

    const onControllerReady = async () => {
      if (!isServiceWorkerEnvironmentReady() || this.transcriber) {
        return;
      }
      this._hideSwWarning();
      await this._initTranscriber();
    };

    navigator.serviceWorker?.addEventListener('controllerchange', onControllerReady);

    const result = await waitForServiceWorkerControl();
    if (result.ready) {
      await onControllerReady();
      return;
    }

    this._showSwWarning(result.reason);
    this.clearStatus();
    this._setUiBusy(true);
  }

  _bindSwDownloadProgress() {
    this._swProgressHandler = (event) => {
      const data = event.data;
      if (!data || data.type !== 'wasm-download-progress' || !this._modelLoading) {
        return;
      }
      this._setModelLoadProgress(data.loaded, data.total);
    };
    navigator.serviceWorker?.addEventListener('message', this._swProgressHandler);
  }

  _setModelLoadProgress(loaded, total) {
    if (!this._modelLoading || loaded == null || loaded < 0) {
      return;
    }

    this._showLoadProgress();
    const progressEl = this.refs.loadProgressEl;
    const loadedMB = loaded / (1024 * 1024);

    if (total > 0) {
      const pct = Math.min(100, (loaded / total) * 100);
      const totalMB = total / (1024 * 1024);
      progressEl.value = pct;
      this.setStatus(
        `Загрузка модели… ${pct.toFixed(1)}% (${loadedMB.toFixed(0)} / ${totalMB.toFixed(0)} MB)`,
      );
      return;
    }

    progressEl.removeAttribute('value');
    this.setStatus(`Загрузка модели… ${loadedMB.toFixed(1)} MB`);
  }

  async _initTranscriber() {
    if (this.transcriber) {
      return;
    }
    this._swReady = true;
    initWasmAssetUrls();
    this._modelLoading = true;
    this._showLoadProgress();
    this.refs.loadProgressEl.removeAttribute('value');
    this.setStatus('Загрузка модели…');
    this.transcriber = new GigaamTranscriber({
      onStatus: (text) => this._onTranscriberStatus(text),
    });
    this._bindTranscriber();
    if (this.transcriber.lastStatusText) {
      this._onTranscriberStatus(this.transcriber.lastStatusText);
    }
    this._setUiBusy(false);
  }

  _onTranscriberStatus(text) {
    if (!text) {
      if (this._modelLoading) {
        return;
      }
      this.clearStatus();
      return;
    }

    if (!this._modelLoading) {
      this.setStatus(text);
      return;
    }

    const mbMatch = text.match(/\((\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*MB\)/);
    if (mbMatch) {
      const loaded = parseFloat(mbMatch[1]) * 1024 * 1024;
      const total = parseFloat(mbMatch[2]) * 1024 * 1024;
      this._setModelLoadProgress(loaded, total);
      return;
    }

    this.setStatus(text);
    this._showLoadProgress();

    const percentMatch = text.match(/(\d+(?:\.\d+)?)\s*%/);
    if (percentMatch) {
      this.refs.loadProgressEl.value = parseFloat(percentMatch[1]);
    } else if (/инициализация/i.test(text)) {
      this.refs.loadProgressEl.removeAttribute('value');
    }
  }

  _showLoadProgress() {
    this.refs.loadProgressWrap.hidden = false;
  }

  _hideLoadProgress() {
    this.refs.loadProgressWrap.hidden = true;
    this.refs.loadProgressEl.value = 0;
  }

  _syncPlayhead() {
    const snap = this.model.snapshot();
    const active = this.model.findSegmentAtTime(this.refs.previewEl.currentTime);
    this.waveform.setState({
      ...snap,
      activeSegmentId: active?.id ?? null,
    });
    this.transcriptPanel.setActiveSegmentId(active?.id ?? null);
  }

  _bindWaveform() {
    this.waveform.onSeek = (time) => this.seekTo(time);
    this.waveform.onSegmentClick = (segmentId) => {
      this.model.setSelectedSegment(segmentId);
      this.transcriptPanel.scrollToSegment(segmentId, { force: true });
    };
    this.waveform.onRegionSelect = (start, end) => {
      this.model.setSelectedRegion(start, end);
    };
    this.waveform.onSegmentTimingChange = (id, start, end, edge) => {
      const seg = this.model.segments.find((s) => s.id === id);
      if (!seg) {
        return;
      }
      const s = edge === 'start' ? Math.min(start, seg.end - 0.05) : seg.start;
      const e = edge === 'end' ? Math.max(end, seg.start + 0.05) : seg.end;
      this.model.setTiming(id, s, e);
    };
  }

  _bindKeyboard() {
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') {
        return;
      }
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) {
        return;
      }
      if (this.waveform.cancelMarquee()) {
        e.preventDefault();
        return;
      }
      if (this.model.selectedRegion) {
        this.model.clearRegion();
        e.preventDefault();
      }
    });
  }

  _bindAudio() {
    const { previewEl, transportTimeEl } = this.refs;
    previewEl.addEventListener('timeupdate', () => {
      transportTimeEl.textContent = formatDisplayTime(previewEl.currentTime);
      this._syncPlayhead();
    });
    previewEl.addEventListener('play', () => {
      this.refs.playPauseBtn.textContent = '⏸';
    });
    previewEl.addEventListener('pause', () => {
      this.refs.playPauseBtn.textContent = '▶';
    });
    previewEl.addEventListener('ended', () => {
      this.refs.playPauseBtn.textContent = '▶';
    });
  }

  seekTo(timeSec) {
    const { previewEl } = this.refs;
    if (!previewEl.src) {
      return;
    }
    previewEl.currentTime = Math.max(0, timeSec);
    previewEl.play().catch(() => {});
    this._syncPlayhead();
  }

  appendLog(message) {
    this.refs.logEl.textContent += message + '\n';
    const scrollEl = this.refs.logEl.parentElement;
    if (scrollEl) {
      scrollEl.scrollTop = scrollEl.scrollHeight;
    }
  }

  clearStatus() {
    this.refs.statusEl.textContent = '';
    this.refs.statusEl.style.display = 'none';
  }

  setStatus(text) {
    this.refs.statusEl.textContent = text;
    this.refs.statusEl.style.display = text ? 'inline' : 'none';
  }

  _setUiBusy(busy) {
    const t = this.transcriber;
    const transcribing = t?.isBusy ?? false;
    const live = (t?.isLive ?? false) || this.isLiveActive;
    const ready = t?.isReady ?? false;
    const swBlocked = !this._swReady;
    const { refs } = this;

    refs.runBtn.disabled =
      swBlocked || busy || transcribing || !ready || !this.currentBlob;
    refs.stopTranscribeBtn.disabled = !(transcribing || this._transcribingActive);
    refs.recordBtn.disabled =
      swBlocked || busy || transcribing || !ready || this.isRecording || live;
    refs.liveBtn.disabled =
      swBlocked || busy || transcribing || !ready || this.isRecording || live;
    refs.fileInput.disabled = busy || transcribing || live;
    refs.audioUrlInput.disabled = busy || transcribing || live;
    refs.loadAudioUrlBtn.disabled =
      busy || transcribing || live || !refs.audioUrlInput.value.trim();
    refs.playPauseBtn.disabled = !previewElHasSrc(refs.previewEl);
    const hasSegments = this.model.segments.length > 0;
    refs.downloadSrtBtn.disabled =
      busy || transcribing || !this.hasTranscript || !hasSegments;
    refs.downloadShareHtmlBtn.disabled =
      busy || transcribing || !this.hasTranscript || !hasSegments;
  }

  async loadAudioBlob(blob, name) {
    if (this.previewUrl) {
      URL.revokeObjectURL(this.previewUrl);
    }
    this.currentBlob = blob;
    this.previewUrl = URL.createObjectURL(blob);
    this.refs.previewEl.src = this.previewUrl;
    this.refs.fileNameEl.textContent = name;
    this.refs.playPauseBtn.disabled = false;

    try {
      this.audioBuffer = await decodeAudioBlobToBuffer(blob);
      this.waveform.setAudioBuffer(this.audioBuffer);
    } catch (err) {
      this.appendLog(`Декодирование аудио: ${err.message}`);
      this.waveform.setAudioBuffer(null);
    }
  }

  _bindTranscriber() {
    const t = this.transcriber;

    t.addEventListener('ready', async () => {
      this._modelLoading = false;
      this._hideLoadProgress();
      this.clearStatus();
      this._setUiBusy(false);
      this.appendLog('Модель готова');
      await this._logWasmCacheStatus();
      this._requestOpfsPrefetch();
    });
    t.addEventListener('error', (e) => {
      this._modelLoading = false;
      this._hideLoadProgress();
      this.setStatus(e.message);
      this.appendLog(`Ошибка: ${e.message}`);
    });
    t.addEventListener('transcribe-start', (e) => {
      this.appendLog(`[${formatClock(e.detail.startedAt)}] распознавание (${e.detail.source})`);
      if (!e.detail.live) {
        this.model.clear();
      }
    });
    t.addEventListener('transcribe-segment', (e) => {
      const { segments, live } = e.detail;
      if (live) {
        const prevLen = this.model.segments.length;
        for (let i = prevLen; i < segments.length; i++) {
          this.model.appendSegment(segments[i]);
        }
        if (segments.length > 0 && segments.length <= prevLen && prevLen > 0) {
          const lastAsr = segments[segments.length - 1];
          const lastModel = this.model.segments[prevLen - 1];
          if (lastModel && lastAsr) {
            this.model.updateText(lastModel.id, lastAsr.text);
          }
        }
      } else {
        this.model.importFromAsr(segments);
      }
      this.hasTranscript = true;
      this._syncViews();
    });
    t.addEventListener('transcribe-end', (e) => {
      const { segments, stats, finishedAt, durationMs, live, cancelled } = e.detail;
      if (!live) {
        this.model.importFromAsr(segments);
      }
      this.hasTranscript = true;
      let line =
        `[${formatClock(finishedAt)}] готово — ${(durationMs / 1000).toFixed(1)} с, ` +
        `сегментов: ${this.model.segments.length}`;
      if (cancelled) {
        line += ' (остановлено)';
      }
      if (stats) {
        line += ` | VAD ${stats.vadProfile}, ASR ${stats.asrRuns}`;
      }
      this.appendLog(line);
      this.clearStatus();
      this._transcribingActive = false;
      this._setUiBusy(false);
      this._syncViews();
    });
    t.addEventListener('transcribe-error', (e) => {
      this.appendLog(`Ошибка: ${e.detail.error.message}`);
      this.clearStatus();
      this._transcribingActive = false;
      this._setUiBusy(false);
    });
  }

  async stopTranscription() {
    if (!this.transcriber) {
      return;
    }
    if (this.isLiveActive || this.transcriber.isLive) {
      await this.stopLive();
      return;
    }
    if (!this.transcriber.isBusy && !this._transcribingActive) {
      return;
    }
    this.appendLog('Остановка распознавания…');
    this.transcriber.cancelBatch();
  }

  _bindToolbar() {
    const { refs } = this;
    refs.runBtn.addEventListener('click', () => this.transcribe());
    refs.stopTranscribeBtn.addEventListener('click', () => this.stopTranscription());
    refs.downloadSrtBtn.addEventListener('click', () => this.downloadSrt());
    refs.downloadShareHtmlBtn.addEventListener('click', () => this.downloadShareHtml());
    refs.recordBtn.addEventListener('click', () => this.toggleRecording());
    refs.liveBtn.addEventListener('click', () => this.toggleLive());
    refs.playPauseBtn.addEventListener('click', () => this.togglePlay());
    refs.fileInput.addEventListener('change', () => this.onFileSelected());
    refs.audioUrlInput.value = loadAudioUrl();
    refs.loadAudioUrlBtn.disabled = !refs.audioUrlInput.value.trim();
    refs.audioUrlInput.addEventListener('input', () => {
      refs.loadAudioUrlBtn.disabled =
        (this.transcriber?.isBusy ?? false) ||
        this.isLiveActive ||
        !refs.audioUrlInput.value.trim();
    });
    refs.audioUrlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.loadAudioFromUrl();
      }
    });
    refs.loadAudioUrlBtn.addEventListener('click', () => this.loadAudioFromUrl());
  }

  _bindUrlAudio() {
    const loadFromLocation = () => {
      const url = parseAudioUrlFromLocation();
      if (!url) {
        return;
      }
      const current = this.refs.audioUrlInput.value.trim();
      if (url === current && this.currentBlob) {
        return;
      }
      this.refs.audioUrlInput.value = url;
      void this.loadAudioFromUrl(url);
    };

    window.addEventListener('popstate', loadFromLocation);

    const urlFromLocation = parseAudioUrlFromLocation();
    if (urlFromLocation) {
      this.refs.audioUrlInput.value = urlFromLocation;
      void this.loadAudioFromUrl(urlFromLocation);
    }
  }

  _bindSettings() {
    const { refs } = this;
    const urls = loadWasmAssetUrls();
    refs.wasmBinaryUrlInput.value = urls.wasmBinaryUrl;
    refs.wasmDataUrlInput.value = urls.wasmDataUrl;

    const open = () => {
      refs.settingsDrawer.classList.add('open');
      refs.settingsBackdrop.classList.add('open');
    };
    const close = () => {
      refs.settingsDrawer.classList.remove('open');
      refs.settingsBackdrop.classList.remove('open');
    };

    refs.settingsBtn.addEventListener('click', open);
    refs.settingsCloseBtn.addEventListener('click', close);
    refs.settingsBackdrop.addEventListener('click', close);

    refs.wasmSaveBtn.addEventListener('click', () => {
      try {
        const saved = saveWasmAssetUrls({
          wasmBinaryUrl: refs.wasmBinaryUrlInput.value,
          wasmDataUrl: refs.wasmDataUrlInput.value,
        });
        applyWasmAssetUrls(saved);
        this.appendLog('URL WASM сохранены, перезагрузка…');
        setTimeout(() => location.reload(), 400);
      } catch (err) {
        alert(`Некорректный URL: ${err.message}`);
      }
    });

    refs.wasmResetBtn.addEventListener('click', () => {
      refs.wasmBinaryUrlInput.value = '';
      refs.wasmDataUrlInput.value = '';
      saveWasmAssetUrls({ wasmBinaryUrl: '', wasmDataUrl: '' });
      applyWasmAssetUrls({ wasmBinaryUrl: '', wasmDataUrl: '' });
      this.appendLog('Сброс URL WASM, перезагрузка…');
      setTimeout(() => location.reload(), 400);
    });

    this._fillVadInputs('file');
    refs.vadResetFileBtn.addEventListener('click', () => {
      refs.vadProfileSelect.value = 'file';
      this._fillVadInputs('file');
    });
    refs.vadResetMicBtn.addEventListener('click', () => {
      refs.vadProfileSelect.value = 'microphone';
      this._fillVadInputs('microphone');
    });
    refs.vadProfileSelect.addEventListener('change', () => {
      if (refs.vadProfileSelect.value) {
        this._fillVadInputs(refs.vadProfileSelect.value);
      }
    });
  }

  _fillVadInputs(profileName) {
    const d = getDefaultVadOptions(profileName);
    const r = this.refs;
    r.vadThresholdInput.value = d.threshold;
    r.vadMinSilenceInput.value = d.minSilenceDuration;
    r.vadMinSpeechInput.value = d.minSpeechDuration;
    r.vadMaxSpeechInput.value = d.maxSpeechDuration;
    r.vadMinRmsInput.value = d.minSegmentRms;
  }

  _applyVad(sourceHint) {
    if (!this.transcriber) {
      return;
    }
    const r = this.refs;
    const vadProfile = r.vadProfileSelect.value || undefined;
    const vad = {
      threshold: Number(r.vadThresholdInput.value),
      minSilenceDuration: Number(r.vadMinSilenceInput.value),
      minSpeechDuration: Number(r.vadMinSpeechInput.value),
      maxSpeechDuration: Number(r.vadMaxSpeechInput.value),
      minSegmentRms: Number(r.vadMinRmsInput.value),
    };
    const compareProfile = resolveVadProfile(sourceHint, vadProfile);
    const defaults = getDefaultVadOptions(compareProfile);
    const hasCustom = Object.keys(defaults).some((k) => vad[k] !== defaults[k]);
    this.transcriber.vadProfile = vadProfile;
    this.transcriber.setVadOptions(hasCustom ? vad : null);
  }

  togglePlay() {
    const a = this.refs.previewEl;
    if (!a.src) {
      return;
    }
    if (a.paused) {
      a.play();
    } else {
      a.pause();
    }
  }

  async onFileSelected() {
    const file = this.refs.fileInput.files[0];
    if (!file) {
      return;
    }
    this.refs.audioUrlInput.value = '';
    saveAudioUrl('');
    clearQueryAudioUrl();
    this.audioSourceLabel = `файл: ${file.name}`;
    await this.loadAudioBlob(file, file.name);
    this.model.clear();
    this.hasTranscript = false;
    this.appendLog(`Файл: ${file.name}`);
    this._setUiBusy(false);
  }

  async loadAudioFromUrl(urlOverride) {
    const url = (urlOverride || this.refs.audioUrlInput.value).trim();
    if (!url) {
      return;
    }
    this.refs.audioUrlInput.value = url;
    this._setUiBusy(true);
    this.setStatus('Загрузка аудио по URL…');
    try {
      const blob = await fetchAudioFromUrl(url);
      saveAudioUrl(url);
      setQueryAudioUrl(url);
      this.refs.fileInput.value = '';
      this.audioSourceLabel = `url: ${url}`;
      const name = fileNameFromAudioUrl(url);
      await this.loadAudioBlob(blob, name);
      this.model.clear();
      this.hasTranscript = false;
      this.appendLog(`URL: ${url}`);
      this.clearStatus();
    } catch (err) {
      this.setStatus(`Ошибка URL: ${err.message}`);
      this.appendLog(`URL: ${err.message}`);
    } finally {
      this._setUiBusy(false);
    }
  }

  async transcribe() {
    if (!this.transcriber) {
      return;
    }
    const file = this.refs.fileInput.files[0];
    const blob = file || this.currentBlob;
    if (!blob) {
      alert('Выберите файл, укажите URL или запишите аудио');
      return;
    }
    const source =
      (file && `файл: ${file.name}`) || this.audioSourceLabel || 'микрофон';
    this._transcribingActive = true;
    this._setUiBusy(true);
    this.hasTranscript = false;
    this._applyVad(source);
    try {
      await this.transcriber.transcribe(blob, { source });
    } catch (err) {
      if (err instanceof TranscriptionCancelledError) {
        this.appendLog('Распознавание остановлено');
        this.clearStatus();
      } else if (err.message !== 'Transcriber terminated') {
        this.appendLog(`Ошибка: ${err.message}`);
      }
    } finally {
      this._transcribingActive = false;
      this._setUiBusy(false);
    }
  }

  downloadSrt() {
    const srt = this.model.toSrt({ forceSpeaker: this.model.speakers.length > 1 });
    if (!srt) {
      return;
    }
    const baseName =
      this.refs.fileInput.files[0]?.name.replace(/\.[^.]+$/, '') ||
      this.refs.fileNameEl.textContent.replace(/\.[^.]+$/, '') ||
      'transcript';
    const blob = new Blob([srt], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${baseName}.srt`;
    link.click();
    URL.revokeObjectURL(url);
    this.appendLog(`SRT: ${baseName}.srt`);
  }

  downloadShareHtml() {
    const snap = this.model.snapshot();
    if (!snap.segments.length) {
      return;
    }
    const baseName =
      this.refs.fileInput.files[0]?.name.replace(/\.[^.]+$/, '') ||
      this.refs.fileNameEl.textContent.replace(/\.[^.]+$/, '') ||
      'transcript';
    const audioUrl = this.refs.fileInput.files[0]?.name || '';
    const payload = buildSharePayload({
      model: this.model,
      audioBuffer: this.audioBuffer,
      title: baseName,
      audioUrl,
    });
    downloadShareHtml(payload, `${baseName}.html`);
    this.appendLog(
      `HTML: ${baseName}.html — выложите рядом с аудио (${audioUrl || 'выбор файла в браузере'})`,
    );
  }

  async toggleRecording() {
    if (this.isRecording) {
      this.stopRecording();
      return;
    }
    try {
      await this.startRecording();
    } catch (err) {
      alert('Нет доступа к микрофону');
      this.appendLog(`Запись: ${err.message}`);
    }
  }

  async startRecording() {
    this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.recordedChunks = [];
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';
    this.mediaRecorder = new MediaRecorder(this.micStream, { mimeType });
    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        this.recordedChunks.push(e.data);
      }
    };
    this.mediaRecorder.onstop = async () => {
      this.micStream?.getTracks().forEach((t) => t.stop());
      this.micStream = null;
      const blob = new Blob(this.recordedChunks, { type: this.mediaRecorder.mimeType });
      const name = `запись-${new Date().toISOString().replace(/[:.]/g, '-')}.webm`;
      this.refs.fileInput.value = '';
      this.refs.audioUrlInput.value = '';
      saveAudioUrl('');
      clearQueryAudioUrl();
      this.audioSourceLabel = `запись: ${name}`;
      await this.loadAudioBlob(blob, name);
      this.appendLog(`Запись: ${name}`);
      await this.transcribe();
    };
    this.mediaRecorder.start();
    this.isRecording = true;
    this.refs.recordBtn.textContent = '■ Стоп';
    this.refs.recordBtn.classList.add('recording');
    this._showRecordTimer();
  }

  stopRecording() {
    if (this.mediaRecorder?.state !== 'inactive') {
      this.mediaRecorder.stop();
    }
    this.isRecording = false;
    this.refs.recordBtn.textContent = '● Запись';
    this.refs.recordBtn.classList.remove('recording');
    this._hideRecordTimer();
  }

  async toggleLive() {
    if (this.isLiveActive) {
      await this.stopLive();
      return;
    }
    try {
      await this.startLive();
    } catch (err) {
      this.cleanupLiveAudio();
      this.isLiveActive = false;
      this.refs.liveBtn.textContent = '● Live';
      this.refs.liveBtn.classList.remove('live', 'recording');
      this._hideRecordTimer();
      this._setUiBusy(false);
      alert('Не удалось начать Live');
    }
  }

  async startLive() {
    if (!this.transcriber) {
      throw new Error('Service Worker не активен');
    }
    this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.liveAudioCtx = new AudioContext({ sampleRate: 16000 });
    this.liveMicSource = this.liveAudioCtx.createMediaStreamSource(this.micStream);
    this.liveSamples = [];
    const bufferSize = 4096;
    this.liveProcessor = this.liveAudioCtx.createScriptProcessor(bufferSize, 1, 1);
    this.liveProcessor.onaudioprocess = (e) => {
      if (!this.isLiveActive) {
        return;
      }
      let samples = new Float32Array(e.inputBuffer.getChannelData(0));
      samples = downsampleBuffer(samples, this.liveAudioCtx.sampleRate, 16000);
      const copy = new Float32Array(samples);
      this.liveSamples.push(copy);
      this.transcriber.feedLiveAudio(copy);
    };
    this.liveMicSource.connect(this.liveProcessor);
    this.liveProcessor.connect(this.liveAudioCtx.destination);

    this.model.clear();
    this.hasTranscript = false;
    this._applyVad('live: микрофон');
    this.transcriber.startLive({ source: 'live: микрофон' });

    this.isLiveActive = true;
    this.refs.liveBtn.textContent = '■ Стоп Live';
    this.refs.liveBtn.classList.add('live', 'recording');
    this._showLiveTimer();
    this.appendLog('Live начат');
    this._setUiBusy(true);
  }

  async stopLive() {
    if (!this.isLiveActive) {
      return;
    }
    this.isLiveActive = false;
    if (this.liveProcessor) {
      this.liveProcessor.onaudioprocess = null;
    }
    this.appendLog('Live останавливается…');
    try {
      await this.transcriber.stopLive();
    } finally {
      this.cleanupLiveAudio();
      this.refs.liveBtn.textContent = '● Live';
      this.refs.liveBtn.classList.remove('live', 'recording');
      this._hideRecordTimer();
      await this._buildLiveWaveform();
      this._setUiBusy(false);
    }
  }

  async _buildLiveWaveform() {
    if (!this.liveSamples.length) {
      return;
    }
    let total = 0;
    for (const c of this.liveSamples) {
      total += c.length;
    }
    const merged = new Float32Array(total);
    let off = 0;
    for (const c of this.liveSamples) {
      merged.set(c, off);
      off += c.length;
    }
    this.liveSamples = [];
    const blob = encodeWavBlob(merged, 16000);
    await this.loadAudioBlob(blob, 'live-session.wav');
    this.appendLog('Waveform live-сессии построен');
  }

  cleanupLiveAudio() {
    if (this.liveProcessor) {
      this.liveProcessor.onaudioprocess = null;
      this.liveProcessor.disconnect();
      this.liveProcessor = null;
    }
    if (this.liveMicSource) {
      this.liveMicSource.disconnect();
      this.liveMicSource = null;
    }
    if (this.liveAudioCtx) {
      this.liveAudioCtx.close().catch(() => {});
      this.liveAudioCtx = null;
    }
    if (this.micStream && !this.isRecording) {
      this.micStream.getTracks().forEach((t) => t.stop());
      this.micStream = null;
    }
  }

  _showRecordTimer() {
    this.recordStartedAt = Date.now();
    const el = this.refs.recordTimerEl;
    el.classList.add('visible');
    this.recordTimerInterval = setInterval(() => {
      const s = Math.floor((Date.now() - this.recordStartedAt) / 1000);
      el.textContent = `Запись: ${s} с`;
    }, 1000);
  }

  _showLiveTimer() {
    this.liveStartedAt = Date.now();
    const el = this.refs.recordTimerEl;
    el.classList.add('visible', 'live');
    this.recordTimerInterval = setInterval(() => {
      const s = Math.floor((Date.now() - this.liveStartedAt) / 1000);
      el.textContent = `Live: ${s} с`;
    }, 1000);
  }

  _hideRecordTimer() {
    clearInterval(this.recordTimerInterval);
    this.refs.recordTimerEl.classList.remove('visible', 'live', 'recording');
    this.refs.recordTimerEl.textContent = '';
  }

  async _logWasmCacheStatus() {
    if (!navigator.storage?.getDirectory || typeof getWasmBinaryOpfsName !== 'function') {
      return;
    }
    try {
      const root = await navigator.storage.getDirectory();
      for (const name of [getWasmBinaryOpfsName(), getWasmDataOpfsName()]) {
        try {
          await root.getFileHandle(name);
          this.appendLog(`OPFS: ${name}`);
        } catch {
          this.appendLog(`Не в OPFS: ${name}`);
        }
      }
    } catch (err) {
      this.appendLog(`OPFS: ${err.message}`);
    }
  }

  _requestOpfsPrefetch() {
    const c = navigator.serviceWorker?.controller;
    if (!c || typeof resolveWasmAssetUrls !== 'function') {
      return;
    }
    c.postMessage({
      type: 'prefetch-data-opfs',
      url: resolveWasmAssetUrls(location.href)[1],
    });
  }
}

function previewElHasSrc(el) {
  return Boolean(el.src);
}

function formatClock(date) {
  return date.toLocaleTimeString('ru-RU', { hour12: false });
}

async function decodeAudioBlobToBuffer(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  const ctx = new AudioContext();
  const buffer = await ctx.decodeAudioData(arrayBuffer);
  await ctx.close();
  return buffer;
}

function encodeWavBlob(samples, sampleRate) {
  const numChannels = 1;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  writeStr(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(view, 8, 'WAVE');
  writeStr(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeStr(view, 36, 'data');
  view.setUint32(40, dataSize, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

function writeStr(view, offset, str) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

export function createEditorController() {
  initWasmAssetUrls();
  return new EditorController({
    fileInput: document.getElementById('fileInput'),
    audioUrlInput: document.getElementById('audioUrlInput'),
    loadAudioUrlBtn: document.getElementById('loadAudioUrlBtn'),
    runBtn: document.getElementById('runBtn'),
    stopTranscribeBtn: document.getElementById('stopTranscribeBtn'),
    recordBtn: document.getElementById('recordBtn'),
    liveBtn: document.getElementById('liveBtn'),
    downloadSrtBtn: document.getElementById('downloadSrtBtn'),
    downloadShareHtmlBtn: document.getElementById('downloadShareHtmlBtn'),
    settingsBtn: document.getElementById('settingsBtn'),
    settingsDrawer: document.getElementById('settingsDrawer'),
    settingsBackdrop: document.getElementById('settingsBackdrop'),
    settingsCloseBtn: document.getElementById('settingsCloseBtn'),
    statusEl: document.getElementById('status'),
    loadProgressWrap: document.getElementById('loadProgressWrap'),
    loadProgressEl: document.getElementById('loadProgress'),
    swWarningEl: document.getElementById('swWarning'),
    swWarningTextEl: document.getElementById('swWarningText'),
    swReloadBtn: document.getElementById('swReloadBtn'),
    recordTimerEl: document.getElementById('recordTimer'),
    logEl: document.getElementById('log'),
    previewEl: document.getElementById('preview'),
    fileNameEl: document.getElementById('fileName'),
    playPauseBtn: document.getElementById('playPauseBtn'),
    transportTimeEl: document.getElementById('transportTime'),
    waveformContainer: document.getElementById('waveformContainer'),
    speakersPanel: document.querySelector('.panel-speakers'),
    transcriptPanel: document.querySelector('.panel-transcript'),
    wasmBinaryUrlInput: document.getElementById('wasmBinaryUrlInput'),
    wasmDataUrlInput: document.getElementById('wasmDataUrlInput'),
    wasmSaveBtn: document.getElementById('wasmSaveBtn'),
    wasmResetBtn: document.getElementById('wasmResetBtn'),
    vadProfileSelect: document.getElementById('vadProfileSelect'),
    vadThresholdInput: document.getElementById('vadThreshold'),
    vadMinSilenceInput: document.getElementById('vadMinSilence'),
    vadMinSpeechInput: document.getElementById('vadMinSpeech'),
    vadMaxSpeechInput: document.getElementById('vadMaxSpeech'),
    vadMinRmsInput: document.getElementById('vadMinRms'),
    vadResetFileBtn: document.getElementById('vadResetFileBtn'),
    vadResetMicBtn: document.getElementById('vadResetMicBtn'),
  });
}
