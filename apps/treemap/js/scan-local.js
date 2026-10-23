// A folder picked from the local disk (`<input webkitdirectory>`): the browser has already listed
// it, with sizes, so this only files each entry under its folders.
//
// It works in slices of about a frame and yields between them, so a folder of a few hundred
// thousand files keeps the window answering and the progress moving. The first version yielded
// with `requestAnimationFrame`, which a browser stops calling in a frame that cannot be seen: a
// treemap window left behind another one stopped scanning until it was looked at again.

import { folder, childFolder, addFile, finish } from './tree.js';
import { yieldToBrowser } from './yield.js';

const SLICE_MS = 12;

export function rootNameOf(files) {
  for (let i = 0; i < files.length; i++) {
    const rel = files[i].webkitRelativePath || '';
    const slash = rel.indexOf('/');
    if (slash > 0) return rel.slice(0, slash);
  }
  return 'Folder';
}

// files: a FileList or an array of {name, size, webkitRelativePath}. Resolves with the finished
// root, or null for nothing picked or a scan that was stopped.
export async function scanFiles(files, { onProgress, stopped = () => false, now = () => performance.now() } = {}) {
  const total = files.length;
  if (!total) return null;
  const root = folder(rootNameOf(files));
  let bytes = 0;
  let i = 0;
  while (i < total) {
    const until = now() + SLICE_MS;
    do {
      const entry = files[i];
      const parts = (entry.webkitRelativePath || entry.name).split('/');
      // The first part is the folder that was picked, which is the root itself, and the last the
      // file's name.
      let parent = root;
      for (let p = 1; p < parts.length - 1; p++) {
        if (parts[p]) parent = childFolder(parent, parts[p]);
      }
      addFile(parent, parts[parts.length - 1], entry.size, entry);
      bytes += entry.size;
      i++;
    } while (i < total && now() < until);
    onProgress?.({ files: i, total, bytes });
    if (i < total) {
      await yieldToBrowser();
      if (stopped()) return null;
    }
  }
  return finish(root);
}
