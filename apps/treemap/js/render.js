import { formatBytes, truncateLabel } from './format.js';
import { getNodeColor } from './colors.js';

export class TreemapRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.rects = [];
    this.hoverIndex = -1;
    this.dpr = 1;
    this.width = 0;
    this.height = 0;
  }

  resize(width, height) {
    this.dpr = window.devicePixelRatio || 1;
    this.width = width;
    this.height = height;
    this.canvas.width = Math.round(width * this.dpr);
    this.canvas.height = Math.round(height * this.dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  setLayout(rects) {
    this.rects = rects;
    this.hoverIndex = -1;
    this.draw();
  }

  setHoverIndex(index) {
    if (this.hoverIndex === index) return;
    this.hoverIndex = index;
    this.draw();
  }

  draw() {
    const { ctx, width, height, rects, hoverIndex } = this;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#12121f';
    ctx.fillRect(0, 0, width, height);

    for (let i = 0; i < rects.length; i++) {
      const rect = rects[i];
      const node = rect.data;
      const colors = getNodeColor(node);
      const isHovered = i === hoverIndex;

      ctx.fillStyle = isHovered ? colors.hover : colors.fill;
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);

      if (isHovered) {
        ctx.strokeStyle = 'rgba(168, 218, 220, 0.6)';
        ctx.lineWidth = 2;
        ctx.strokeRect(rect.x + 1, rect.y + 1, rect.w - 2, rect.h - 2);
      }

      if (rect.w > 40 && rect.h > 16) {
        this.drawLabel(rect, node);
      }
    }
  }

  drawLabel(rect, node) {
    const { ctx } = this;
    const pad = 4;
    const maxW = rect.w - pad * 2;
    if (maxW <= 0) return;

    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x + pad, rect.y + pad, maxW, rect.h - pad * 2);
    ctx.clip();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.textBaseline = 'top';

    const nameSize = rect.h > 28 ? 11 : 10;
    ctx.font = `600 ${nameSize}px system-ui, -apple-system, sans-serif`;
    const name = truncateLabel(node.name, Math.floor(maxW / (nameSize * 0.55)));
    ctx.fillText(name, rect.x + pad, rect.y + pad);

    if (rect.h > 28) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
      ctx.font = '10px system-ui, -apple-system, sans-serif';
      ctx.fillText(formatBytes(node.size), rect.x + pad, rect.y + pad + nameSize + 2);
    }

    ctx.restore();
  }

  hitTest(clientX, clientY) {
    const bounds = this.canvas.getBoundingClientRect();
    const x = clientX - bounds.left;
    const y = clientY - bounds.top;

    for (let i = this.rects.length - 1; i >= 0; i--) {
      const r = this.rects[i];
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
        return i;
      }
    }
    return -1;
  }

  getRect(index) {
    return index >= 0 ? this.rects[index] : null;
  }
}
