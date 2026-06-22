import { formatTimeRange } from './waveform-view.js';

export class TranscriptPanel {
  constructor(container, model, callbacks = {}) {
    this.container = container;
    this.model = model;
    this.onSeek = callbacks.onSeek || (() => {});
    this.getPlayhead = callbacks.getPlayhead || (() => 0);

    this.listEl = container.querySelector('[data-transcript-list]');
    this.toolbar = container.querySelector('[data-transcript-toolbar]');
    this.emptyEl = container.querySelector('[data-transcript-empty]');
    this._activeSegmentId = null;

    this.toolbar?.querySelector('[data-split]')?.addEventListener('click', () => {
      const id = this.model.selectedSegmentId;
      if (id) {
        this.model.splitAt(id, this.getPlayhead());
      }
    });
    this.toolbar?.querySelector('[data-merge]')?.addEventListener('click', () => {
      const id = this.model.selectedSegmentId;
      if (id) {
        this.model.mergeAdjacent(id);
      }
    });
    this.toolbar?.querySelector('[data-delete]')?.addEventListener('click', () => {
      const id = this.model.selectedSegmentId;
      if (id) {
        this.model.removeSegment(id);
      }
    });
    this.toolbar?.querySelector('[data-assign-region]')?.addEventListener('click', () => {
      const id = this.model.selectedSegmentId;
      const region = this.model.selectedRegion;
      if (id && region) {
        this.model.assignRegionToSegment(id, region.start, region.end);
      }
    });
    this.toolbar?.querySelector('[data-create-from-region]')?.addEventListener('click', () => {
      const region = this.model.selectedRegion;
      if (region) {
        this.model.createSegmentFromRegion(region.start, region.end);
      }
    });
    this.toolbar?.querySelector('[data-clear-region]')?.addEventListener('click', () => {
      this.model.clearRegion();
    });

    this.model.addEventListener('change', (e) => this._onModelChange(e));
    this.render();
  }

  _onModelChange(e) {
    const detail = e.detail || {};
    switch (detail.reason) {
      case 'text':
        return;
      case 'selection':
        this._updateToolbarState(detail);
        this._updateRowSelection(detail.selectedSegmentId);
        return;
      case 'region':
        this._updateToolbarState(detail);
        return;
      case 'speaker':
        this._updateSegmentSpeaker(detail.segmentId);
        return;
      case 'timing':
        this._updateSegmentTiming(detail.segmentId);
        return;
      default:
        this.render();
    }
  }

  _rowForSegment(id) {
    return this.listEl?.querySelector(`[data-segment-id="${id}"]`);
  }

  _updateRowSelection(selectedSegmentId) {
    if (!this.listEl) {
      return;
    }
    for (const row of this.listEl.querySelectorAll('.transcript-row')) {
      row.classList.toggle(
        'transcript-row--selected',
        row.dataset.segmentId === selectedSegmentId,
      );
    }
  }

  _updateSegmentSpeaker(segmentId) {
    const seg = this.model.segments.find((s) => s.id === segmentId);
    const row = this._rowForSegment(segmentId);
    const select = row?.querySelector('.transcript-speaker');
    if (!seg || !select) {
      this.render();
      return;
    }
    select.value = seg.speakerId;
  }

  _updateSegmentTiming(segmentId) {
    const seg = this.model.segments.find((s) => s.id === segmentId);
    const row = this._rowForSegment(segmentId);
    if (!seg || !row) {
      this.render();
      return;
    }
    const idx = this.model.segments.findIndex((s) => s.id === segmentId);
    if (this.listEl.children[idx] !== row) {
      this.render();
      return;
    }
    const timeBtn = row.querySelector('.transcript-time');
    if (timeBtn) {
      timeBtn.textContent = formatTimeRange(seg.start, seg.end);
    }
  }

  _updateToolbarState(snap) {
    const hasRegion = !!snap.selectedRegion;
    const hasSegment = !!snap.selectedSegmentId;
    const clearBtn = this.toolbar?.querySelector('[data-clear-region]');
    const assignBtn = this.toolbar?.querySelector('[data-assign-region]');
    const createBtn = this.toolbar?.querySelector('[data-create-from-region]');
    if (clearBtn) {
      clearBtn.disabled = !hasRegion;
    }
    if (assignBtn) {
      assignBtn.disabled = !(hasRegion && hasSegment);
    }
    if (createBtn) {
      createBtn.disabled = !hasRegion;
    }
  }

  render() {
    const snap = this.model.snapshot();
    const { segments, speakers, selectedSegmentId } = snap;
    this._updateToolbarState(snap);

    if (!segments.length) {
      this.listEl?.replaceChildren();
      if (this.emptyEl) {
        this.emptyEl.hidden = false;
      }
      return;
    }

    if (this.emptyEl) {
      this.emptyEl.hidden = true;
    }
    if (!this.listEl) {
      return;
    }

    this.listEl.replaceChildren();

    for (const seg of segments) {
      const row = document.createElement('div');
      row.className = 'transcript-row';
      row.dataset.segmentId = seg.id;
      if (seg.id === selectedSegmentId) {
        row.classList.add('transcript-row--selected');
      }

      const timeBtn = document.createElement('button');
      timeBtn.type = 'button';
      timeBtn.className = 'transcript-time';
      timeBtn.textContent = formatTimeRange(seg.start, seg.end);
      timeBtn.addEventListener('click', () => {
        this.model.setSelectedSegment(seg.id);
        this.scrollToSegment(seg.id);
        this.onSeek(seg.start);
      });

      const speakerSelect = document.createElement('select');
      speakerSelect.className = 'transcript-speaker';
      for (const sp of speakers) {
        const opt = document.createElement('option');
        opt.value = sp.id;
        opt.textContent = sp.label;
        if (sp.id === seg.speakerId) {
          opt.selected = true;
        }
        speakerSelect.appendChild(opt);
      }
      speakerSelect.addEventListener('change', () => {
        this.model.setSpeaker(seg.id, speakerSelect.value);
      });

      const textArea = document.createElement('textarea');
      textArea.className = 'transcript-text';
      textArea.rows = 2;
      textArea.value = seg.text;
      textArea.addEventListener('input', () => {
        this.model.updateText(seg.id, textArea.value);
      });

      row.addEventListener('click', (e) => {
        if (e.target === textArea || e.target === speakerSelect) {
          return;
        }
        this.model.setSelectedSegment(seg.id);
        this.scrollToSegment(seg.id);
      });

      if (seg.id === this._activeSegmentId) {
        row.classList.add('transcript-row--active');
      }

      const meta = document.createElement('div');
      meta.className = 'transcript-meta';
      meta.appendChild(timeBtn);
      meta.appendChild(speakerSelect);

      row.appendChild(meta);
      row.appendChild(textArea);
      this.listEl.appendChild(row);
    }
  }

  scrollToSegment(id, { force = false } = {}) {
    if (!this.listEl) {
      return;
    }
    const idx = this.model.segments.findIndex((s) => s.id === id);
    if (idx < 0) {
      return;
    }
    const row = this.listEl.children[idx];
    if (!row) {
      return;
    }
    const scrollParent = this.listEl.closest('.panel-body--transcript') || this.listEl;
    if (!force) {
      const parentRect = scrollParent.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      const visible = rowRect.top >= parentRect.top && rowRect.bottom <= parentRect.bottom;
      if (visible) {
        return;
      }
    }
    row.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  }

  setActiveSegmentId(id) {
    if (id === this._activeSegmentId) {
      return;
    }
    if (!this.listEl) {
      this._activeSegmentId = id;
      return;
    }
    for (const row of this.listEl.querySelectorAll('.transcript-row')) {
      row.classList.remove('transcript-row--active');
    }
    this._activeSegmentId = id;
    if (!id) {
      return;
    }
    const idx = this.model.segments.findIndex((s) => s.id === id);
    if (idx >= 0) {
      this.listEl.children[idx]?.classList.add('transcript-row--active');
    }
  }
}
