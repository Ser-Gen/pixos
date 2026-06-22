import { formatDisplayTime } from './srt.js';

function computePeaks(channelData, targetPoints) {
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

export class WaveformView {
  constructor(container, audioEl) {
    this.container = container;
    this.audioEl = audioEl;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'waveform-canvas';
    this.container.replaceChildren(this.canvas);

    this.ctx = this.canvas.getContext('2d');
    this.peaks = null;
    this.duration = 0;
    this.segments = [];
    this.speakers = [];
    this.selectedSegmentId = null;
    this.selectedRegion = null;
    this.activeSegmentId = null;

    this.dragMode = null;
    this.dragSegmentId = null;
    this.dragEdge = null;
    this.marqueeStart = null;
    this.marqueeEnd = null;

    this.onSeek = null;
    this.onSegmentClick = null;
    this.onRegionSelect = null;
    this.onSegmentTimingChange = null;

    this._resizeObserver = new ResizeObserver(() => this.draw());
    this._resizeObserver.observe(this.container);

    this.canvas.addEventListener('pointerdown', (e) => this._onPointerDown(e));
    this.canvas.addEventListener('pointermove', (e) => this._onPointerMove(e));
    this.canvas.addEventListener('pointerup', (e) => this._onPointerUp(e));
    this.canvas.addEventListener('pointerleave', (e) => this._onPointerUp(e));

    if (audioEl) {
      audioEl.addEventListener('timeupdate', () => this.draw());
    }
  }

  setAudioBuffer(buffer) {
    if (!buffer) {
      this.peaks = null;
      this.duration = 0;
      this.draw();
      return;
    }
    this.duration = buffer.duration;
    const data = buffer.getChannelData(0);
    this.peaks = computePeaks(data, 2048);
    this.draw();
  }

  cancelMarquee() {
    if (this.marqueeStart == null && this.marqueeEnd == null && this.dragMode !== 'marquee') {
      return false;
    }
    this.marqueeStart = null;
    this.marqueeEnd = null;
    if (this.dragMode === 'marquee') {
      this.dragMode = null;
    }
    this.draw();
    return true;
  }

  setState({ segments, speakers, selectedSegmentId, selectedRegion, activeSegmentId }) {
    this.segments = segments || [];
    this.speakers = speakers || [];
    this.selectedSegmentId = selectedSegmentId;
    this.selectedRegion = selectedRegion;
    this.activeSegmentId = activeSegmentId;
    this.draw();
  }

  timeToX(timeSec, width) {
    if (!this.duration) {
      return 0;
    }
    return (timeSec / this.duration) * width;
  }

  xToTime(x, width) {
    if (!this.duration) {
      return 0;
    }
    return Math.max(0, Math.min(this.duration, (x / width) * this.duration));
  }

  speakerColor(speakerId) {
    return this.speakers.find((s) => s.id === speakerId)?.color || '#6ea8fe';
  }

  draw() {
    const rect = this.container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const mid = h / 2;
    ctx.fillStyle = '#1a1a1e';
    ctx.fillRect(0, 0, w, h);

    if (this.peaks) {
      const peaks = this.peaks;
      const step = w / peaks.length;
      ctx.fillStyle = '#4a5568';
      for (let i = 0; i < peaks.length; i++) {
        const barH = peaks[i] * (h * 0.42);
        const x = i * step;
        ctx.fillRect(x, mid - barH, Math.max(1, step), barH * 2);
      }
    }

    for (const seg of this.segments) {
      const x1 = this.timeToX(seg.start, w);
      const x2 = this.timeToX(seg.end, w);
      const color = this.speakerColor(seg.speakerId);
      ctx.fillStyle = color + '33';
      ctx.fillRect(x1, 0, x2 - x1, h);
      ctx.strokeStyle = color;
      ctx.lineWidth = seg.id === this.activeSegmentId ? 2.5 : seg.id === this.selectedSegmentId ? 2 : 1;
      ctx.strokeRect(x1, 0, x2 - x1, h);
    }

    if (this.selectedRegion) {
      const x1 = this.timeToX(this.selectedRegion.start, w);
      const x2 = this.timeToX(this.selectedRegion.end, w);
      ctx.fillStyle = 'rgba(110, 168, 254, 0.25)';
      ctx.fillRect(x1, 0, x2 - x1, h);
      ctx.strokeStyle = '#6ea8fe';
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(x1, 0, x2 - x1, h);
      ctx.setLineDash([]);
    }

    if (this.marqueeStart != null && this.marqueeEnd != null) {
      const x1 = this.timeToX(Math.min(this.marqueeStart, this.marqueeEnd), w);
      const x2 = this.timeToX(Math.max(this.marqueeStart, this.marqueeEnd), w);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.fillRect(x1, 0, x2 - x1, h);
    }

    const t = this.audioEl?.currentTime ?? 0;
    const px = this.timeToX(t, w);
    ctx.strokeStyle = '#f87171';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, h);
    ctx.stroke();
  }

  _pointerPos(e) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      width: rect.width,
    };
  }

  _segmentAtTime(timeSec) {
    for (const seg of this.segments) {
      if (timeSec >= seg.start && timeSec <= seg.end) {
        return seg;
      }
    }
    return null;
  }

  _hitSegmentEdge(x, width) {
    const threshold = 6;
    for (const seg of this.segments) {
      const x1 = this.timeToX(seg.start, width);
      const x2 = this.timeToX(seg.end, width);
      if (Math.abs(x - x1) < threshold) {
        return { id: seg.id, edge: 'start' };
      }
      if (Math.abs(x - x2) < threshold) {
        return { id: seg.id, edge: 'end' };
      }
    }
    return null;
  }

  _onPointerDown(e) {
    const { x, width } = this._pointerPos(e);
    const time = this.xToTime(x, width);
    const edge = this._hitSegmentEdge(x, width);

    if (edge && e.shiftKey) {
      this.dragMode = 'edge';
      this.dragSegmentId = edge.id;
      this.dragEdge = edge.edge;
      this.canvas.setPointerCapture(e.pointerId);
      return;
    }

    if (e.button === 0 && e.altKey) {
      this.dragMode = 'marquee';
      this.marqueeStart = time;
      this.marqueeEnd = time;
      this.canvas.setPointerCapture(e.pointerId);
      this.draw();
      return;
    }

    const hit = this._segmentAtTime(time);
    if (hit && this.onSegmentClick) {
      this.onSegmentClick(hit.id, time);
    }
    if (this.onSeek) {
      this.onSeek(time);
    }
    this.canvas.setPointerCapture(e.pointerId);
    this.dragMode = 'seek';
  }

  _onPointerMove(e) {
    const { x, width } = this._pointerPos(e);
    const time = this.xToTime(x, width);

    if (this.dragMode === 'marquee') {
      this.marqueeEnd = time;
      this.draw();
      return;
    }

    if (this.dragMode === 'edge' && this.dragSegmentId) {
      const seg = this.segments.find((s) => s.id === this.dragSegmentId);
      if (seg && this.onSegmentTimingChange) {
        const start = this.dragEdge === 'start' ? time : seg.start;
        const end = this.dragEdge === 'end' ? time : seg.end;
        this.onSegmentTimingChange(this.dragSegmentId, start, end, this.dragEdge);
      }
      return;
    }

    if (this.dragMode === 'seek' && this.onSeek) {
      this.onSeek(time);
    }
  }

  _onPointerUp(e) {
    const { x, width } = this._pointerPos(e);

    if (this.dragMode === 'marquee' && this.marqueeStart != null) {
      const t1 = this.marqueeStart;
      const t2 = this.xToTime(x, width);
      if (Math.abs(t2 - t1) > 0.05 && this.onRegionSelect) {
        this.onRegionSelect(Math.min(t1, t2), Math.max(t1, t2));
      }
      this.marqueeStart = null;
      this.marqueeEnd = null;
    }

    this.dragMode = null;
    this.dragSegmentId = null;
    this.dragEdge = null;
    try {
      this.canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    this.draw();
  }
}

export function formatTimeRange(start, end) {
  return `${formatDisplayTime(start)} – ${formatDisplayTime(end)}`;
}
