// Lets the browser handle input and paint, then carries on. A message to ourselves rather than
// `setTimeout(0)`, which the browser stretches to 4 ms once timers nest, and rather than
// `requestAnimationFrame`, which never fires in a frame that cannot be seen.

const channel = typeof MessageChannel === 'function' ? new MessageChannel() : null;
const waiting = [];
if (channel) {
  channel.port1.onmessage = () => waiting.shift()?.();
}

export function yieldToBrowser() {
  if (!channel) return new Promise((resolve) => setTimeout(resolve, 0));
  return new Promise((resolve) => {
    waiting.push(resolve);
    channel.port2.postMessage(0);
  });
}
