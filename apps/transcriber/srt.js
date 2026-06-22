export function formatSrtTimestamp(seconds) {
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const ms = totalMs % 1000;
  const totalSec = Math.floor(totalMs / 1000);
  const s = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const m = totalMin % 60;
  const h = Math.floor(totalMin / 60);
  return (
    `${String(h).padStart(2, '0')}:` +
    `${String(m).padStart(2, '0')}:` +
    `${String(s).padStart(2, '0')},` +
    `${String(ms).padStart(3, '0')}`
  );
}

export function formatDisplayTime(seconds) {
  return formatSrtTimestamp(seconds).replace(',', '.');
}

export function segmentsToSrt(segments, options = {}) {
  const speakerLabels = options.speakerLabels || {};
  const showSpeaker = options.showSpeaker !== false;
  const lines = [];
  let index = 0;

  for (const seg of segments) {
    const text = (seg.text || '').trim();
    if (!text) {
      continue;
    }
    index += 1;
    lines.push(String(index));
    lines.push(
      `${formatSrtTimestamp(seg.start)} --> ${formatSrtTimestamp(seg.end)}`,
    );
    let line = text;
    if (showSpeaker && seg.speakerId && speakerLabels[seg.speakerId]) {
      line = `[${speakerLabels[seg.speakerId]}] ${text}`;
    }
    lines.push(line);
    lines.push('');
  }

  return lines.join('\n');
}
