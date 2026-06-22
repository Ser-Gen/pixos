export class SpeakersPanel {
  constructor(container, model) {
    this.container = container;
    this.model = model;
    this.listEl = container.querySelector('[data-speakers-list]');
    this.addBtn = container.querySelector('[data-add-speaker]');
    this.hintEl = container.querySelector('[data-diarization-hint]');

    this.addBtn?.addEventListener('click', () => {
      this.model.addSpeaker();
    });

    this.model.addEventListener('change', () => this.render());
    this.render();
  }

  render() {
    if (!this.listEl) {
      return;
    }
    this.listEl.replaceChildren();
    const { speakers } = this.model.snapshot();

    for (const sp of speakers) {
      const row = document.createElement('div');
      row.className = 'speaker-row';

      const swatch = document.createElement('span');
      swatch.className = 'speaker-swatch';
      swatch.style.background = sp.color;

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'speaker-name-input';
      input.value = sp.label;
      input.addEventListener('change', () => {
        this.model.renameSpeaker(sp.id, input.value);
      });

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'btn-icon secondary';
      removeBtn.textContent = '×';
      removeBtn.title = 'Удалить говорящего';
      removeBtn.disabled = speakers.length <= 1;
      removeBtn.addEventListener('click', () => {
        this.model.removeSpeaker(sp.id);
      });

      row.appendChild(swatch);
      row.appendChild(input);
      row.appendChild(removeBtn);
      this.listEl.appendChild(row);
    }

    if (this.hintEl) {
      this.hintEl.hidden = false;
    }
  }
}
