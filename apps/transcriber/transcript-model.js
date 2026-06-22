import { segmentsToSrt } from './srt.js';

const SPEAKER_COLORS = [
  '#6ea8fe',
  '#f59e0b',
  '#34d399',
  '#f472b6',
  '#a78bfa',
  '#22d3ee',
  '#fb7185',
  '#84cc16',
];

let nextId = 1;
function uid(prefix) {
  return `${prefix}-${nextId++}`;
}

export class TranscriptModel extends EventTarget {
  constructor() {
    super();
    this.segments = [];
    this.speakers = [this._createSpeaker('Спикер 1', 0)];
    this.selectedSegmentId = null;
    this.selectedRegion = null;
  }

  _createSpeaker(label, index) {
    return {
      id: uid('spk'),
      label,
      color: SPEAKER_COLORS[index % SPEAKER_COLORS.length],
    };
  }

  get defaultSpeakerId() {
    return this.speakers[0]?.id;
  }

  getSpeaker(id) {
    return this.speakers.find((s) => s.id === id);
  }

  speakerLabelsMap() {
    const map = {};
    for (const s of this.speakers) {
      map[s.id] = s.label;
    }
    return map;
  }

  _emitChange(extra = {}) {
    this.dispatchEvent(
      new CustomEvent('change', {
        detail: { ...this.snapshot(), ...extra },
      }),
    );
  }

  snapshot() {
    return {
      segments: this.segments.map((s) => ({ ...s })),
      speakers: this.speakers.map((s) => ({ ...s })),
      selectedSegmentId: this.selectedSegmentId,
      selectedRegion: this.selectedRegion ? { ...this.selectedRegion } : null,
    };
  }

  clear() {
    this.segments = [];
    this.selectedSegmentId = null;
    this.selectedRegion = null;
    this._emitChange();
  }

  importFromAsr(asrSegments) {
    const speakerId = this.defaultSpeakerId;
    this.segments = (asrSegments || [])
      .filter((seg) => (seg.text || '').trim())
      .map((seg) => ({
        id: uid('seg'),
        start: seg.start,
        end: seg.end,
        text: (seg.text || '').trim(),
        speakerId,
      }));
    this._emitChange();
  }

  importFromDiarization(diarSegments, textByIndex = []) {
    this.segments = (diarSegments || []).map((seg, i) => ({
      id: uid('seg'),
      start: seg.start,
      end: seg.end,
      text: (textByIndex[i] || seg.text || '').trim(),
      speakerId: this._ensureSpeakerForKey(seg.speaker ?? seg.speakerId ?? `spk-${i}`),
    }));
    this._emitChange();
  }

  _ensureSpeakerForKey(key) {
    const label = typeof key === 'number' ? `Спикер ${key + 1}` : String(key);
    let sp = this.speakers.find((s) => s.label === label);
    if (!sp) {
      sp = this._createSpeaker(label, this.speakers.length);
      this.speakers.push(sp);
    }
    return sp.id;
  }

  appendSegment(seg) {
    const speakerId = seg.speakerId || this.defaultSpeakerId;
    const item = {
      id: uid('seg'),
      start: seg.start,
      end: seg.end,
      text: (seg.text || '').trim(),
      speakerId,
    };
    this.segments.push(item);
    this.segments.sort((a, b) => a.start - b.start);
    this._emitChange();
    return item;
  }

  setSelectedSegment(id) {
    this.selectedSegmentId = id;
    this._emitChange({ reason: 'selection' });
  }

  setSelectedRegion(start, end) {
    if (start == null || end == null) {
      this.selectedRegion = null;
    } else {
      this.selectedRegion = { start: Math.min(start, end), end: Math.max(start, end) };
    }
    this._emitChange({ reason: 'region' });
  }

  clearRegion() {
    if (!this.selectedRegion) {
      return;
    }
    this.selectedRegion = null;
    this._emitChange({ reason: 'region' });
  }

  clearSelection() {
    if (!this.selectedSegmentId && !this.selectedRegion) {
      return;
    }
    this.selectedSegmentId = null;
    this.selectedRegion = null;
    this._emitChange({ reason: 'selection' });
  }

  updateText(id, text) {
    const seg = this.segments.find((s) => s.id === id);
    if (!seg) {
      return;
    }
    seg.text = text;
    this._emitChange({ reason: 'text', segmentId: id });
  }

  setSpeaker(segmentId, speakerId) {
    const seg = this.segments.find((s) => s.id === segmentId);
    if (!seg || !this.getSpeaker(speakerId)) {
      return;
    }
    seg.speakerId = speakerId;
    this._emitChange({ reason: 'speaker', segmentId });
  }

  setTiming(id, start, end) {
    const seg = this.segments.find((s) => s.id === id);
    if (!seg) {
      return;
    }
    seg.start = Math.max(0, start);
    seg.end = Math.max(seg.start + 0.05, end);
    this.segments.sort((a, b) => a.start - b.start);
    this._emitChange({ reason: 'timing', segmentId: id });
  }

  splitAt(id, timeSec) {
    const seg = this.segments.find((s) => s.id === id);
    if (!seg || timeSec <= seg.start + 0.05 || timeSec >= seg.end - 0.05) {
      return;
    }
    const second = {
      id: uid('seg'),
      start: timeSec,
      end: seg.end,
      text: '',
      speakerId: seg.speakerId,
    };
    seg.end = timeSec;
    const idx = this.segments.indexOf(seg);
    this.segments.splice(idx + 1, 0, second);
    this._emitChange();
  }

  mergeAdjacent(id) {
    const idx = this.segments.findIndex((s) => s.id === id);
    if (idx < 0 || idx >= this.segments.length - 1) {
      return;
    }
    const a = this.segments[idx];
    const b = this.segments[idx + 1];
    a.end = b.end;
    a.text = [a.text, b.text].filter(Boolean).join(' ').trim();
    this.segments.splice(idx + 1, 1);
    this._emitChange();
  }

  removeSegment(id) {
    this.segments = this.segments.filter((s) => s.id !== id);
    if (this.selectedSegmentId === id) {
      this.selectedSegmentId = null;
    }
    this._emitChange();
  }

  assignRegionToSegment(segmentId, start, end) {
    this.setTiming(segmentId, start, end);
    this.setSelectedRegion(null);
  }

  createSegmentFromRegion(start, end, text = '') {
    const item = {
      id: uid('seg'),
      start: Math.min(start, end),
      end: Math.max(start, end),
      text: text.trim(),
      speakerId: this.defaultSpeakerId,
    };
    this.segments.push(item);
    this.segments.sort((a, b) => a.start - b.start);
    this.selectedSegmentId = item.id;
    this.setSelectedRegion(null);
    this._emitChange();
    return item;
  }

  addSpeaker(label) {
    const sp = this._createSpeaker(label || `Спикер ${this.speakers.length + 1}`, this.speakers.length);
    this.speakers.push(sp);
    this._emitChange();
    return sp;
  }

  renameSpeaker(id, label) {
    const sp = this.getSpeaker(id);
    if (!sp) {
      return;
    }
    sp.label = label.trim() || sp.label;
    this._emitChange();
  }

  removeSpeaker(id) {
    if (this.speakers.length <= 1) {
      return;
    }
    const fallback = this.speakers.find((s) => s.id !== id)?.id || this.defaultSpeakerId;
    this.speakers = this.speakers.filter((s) => s.id !== id);
    for (const seg of this.segments) {
      if (seg.speakerId === id) {
        seg.speakerId = fallback;
      }
    }
    this._emitChange();
  }

  findSegmentAtTime(timeSec) {
    for (const seg of this.segments) {
      if (timeSec >= seg.start && timeSec <= seg.end) {
        return seg;
      }
    }
    return null;
  }

  toPlainText() {
    return this.segments.map((s) => s.text).filter(Boolean).join(' ');
  }

  toSrt(options = {}) {
    const showSpeaker = this.speakers.length > 1 || options.forceSpeaker;
    return segmentsToSrt(this.segments, {
      speakerLabels: this.speakerLabelsMap(),
      showSpeaker,
    });
  }
}
