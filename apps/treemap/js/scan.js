const BATCH_SIZE = 2000;

export function createNode(name, path, isFile = false) {
  return {
    name,
    path,
    size: 0,
    children: new Map(),
    isFile,
    fileCount: 0,
  };
}

function getOrCreateChild(parent, name, path, isFile) {
  let child = parent.children.get(name);
  if (!child) {
    child = createNode(name, path, isFile);
    parent.children.set(name, child);
  }
  return child;
}

function stripRootPrefix(parts, rootName) {
  if (parts.length > 1 && parts[0] === rootName) return parts.slice(1);
  if (parts.length === 1 && parts[0] === rootName) return [];
  return parts;
}

function relPathToNodePath(relPath, rootName) {
  let parts = relPath.split('/').filter(Boolean);
  parts = stripRootPrefix(parts, rootName);
  if (parts.length === 0) return null;
  return [rootName, ...parts].join('/');
}

function addFileToTree(root, relativePath, size) {
  let parts = relativePath.split('/').filter(Boolean);
  if (parts.length === 0) return;

  parts = stripRootPrefix(parts, root.name);
  if (parts.length === 0) return;

  let node = root;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const isFile = i === parts.length - 1;
    const path = [root.name, ...parts.slice(0, i + 1)].join('/');
    node = getOrCreateChild(node, part, path, isFile);
    if (isFile) {
      node.size = size;
      node.fileCount = 1;
    }
  }
}

/**
 * @param {{ relPath: string, size: number }[]} entries
 */
export function buildTreeFromRelativeFiles(entries, rootName = 'root') {
  const root = createNode(rootName, rootName, false);
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry?.relPath) continue;
    addFileToTree(root, entry.relPath, entry.size || 0);
  }
  if (root.children.size === 0) {
    return { root: null, fileCount: 0, folderCount: 0 };
  }
  aggregateSizes(root);
  sortChildren(root);
  return {
    root,
    fileCount: root.fileCount,
    folderCount: countFolders(root),
  };
}

function detectRootName(fileList) {
  const paths = [];
  for (let i = 0; i < fileList.length; i++) {
    paths.push(fileList[i].webkitRelativePath || fileList[i].name);
  }

  const withSlash = paths.filter((p) => p.includes('/'));
  if (withSlash.length > 0) {
    return withSlash[0].split('/')[0] || 'root';
  }

  return 'root';
}

function aggregateSizes(node) {
  if (node.isFile) return node.size;

  let total = 0;
  let files = 0;
  for (const child of node.children.values()) {
    total += aggregateSizes(child);
    files += child.fileCount;
  }
  node.size = total;
  node.fileCount = files;
  return total;
}

export function sortChildren(node) {
  if (node.isFile) return;
  node.sortedChildren = [...node.children.values()].sort((a, b) => b.size - a.size);
  for (const child of node.sortedChildren) {
    sortChildren(child);
  }
}

function countFolders(node) {
  if (node.isFile) return 0;
  let count = 0;
  for (const child of node.children.values()) {
    if (!child.isFile) {
      count += 1 + countFolders(child);
    }
  }
  return count;
}

export function scanFileList(fileList, onProgress) {
  return new Promise((resolve) => {
    const total = fileList.length;
    if (total === 0) {
      resolve({ root: null, fileCount: 0, folderCount: 0, localFileMap: new Map() });
      return;
    }

    const rootName = detectRootName(fileList);
    const root = createNode(rootName, rootName, false);
    const localFileMap = new Map();

    let index = 0;

    function processBatch() {
      const end = Math.min(index + BATCH_SIZE, total);
      for (; index < end; index++) {
        const file = fileList[index];
        const relPath = file.webkitRelativePath || file.name;
        addFileToTree(root, relPath, file.size);
        const nodePath = relPathToNodePath(relPath, rootName);
        if (nodePath) {
          localFileMap.set(nodePath, file);
        }
      }

      onProgress?.({ current: index, total, phase: 'scan' });

      if (index < total) {
        requestAnimationFrame(processBatch);
      } else {
        aggregateSizes(root);
        sortChildren(root);
        const folderCount = countFolders(root);
        onProgress?.({ current: total, total, phase: 'done' });
        resolve({ root, fileCount: root.fileCount, folderCount, localFileMap, combined: false });
      }
    }

    requestAnimationFrame(processBatch);
  });
}

const COMBINED_ROOT_NAME = 'Анализ';

function remapNodePaths(node, fromPrefix, toPrefix, newName) {
  if (newName != null) {
    node.name = newName;
  }
  if (node.path === fromPrefix) {
    node.path = toPrefix;
  } else if (node.path.startsWith(`${fromPrefix}/`)) {
    node.path = `${toPrefix}${node.path.slice(fromPrefix.length)}`;
  }
  if (node.isFile) {
    return;
  }
  node.sortedChildren = null;
  for (const child of node.children.values()) {
    remapNodePaths(child, fromPrefix, toPrefix);
  }
}

function remapFileMapKeys(fileMap, fromPrefix, toPrefix) {
  const remapped = new Map();
  for (const [key, file] of fileMap) {
    if (key === fromPrefix || key.startsWith(`${fromPrefix}/`)) {
      remapped.set(`${toPrefix}${key.slice(fromPrefix.length)}`, file);
    } else {
      remapped.set(key, file);
    }
  }
  return remapped;
}

function attachScanRoot(combinedRoot, scanRoot, sourceFileMap, targetFileMap) {
  let folderName = scanRoot.name;
  if (combinedRoot.children.has(folderName)) {
    let suffix = 2;
    while (combinedRoot.children.has(`${scanRoot.name} (${suffix})`)) {
      suffix += 1;
    }
    folderName = `${scanRoot.name} (${suffix})`;
  }

  const oldPrefix = scanRoot.path;
  const newPrefix = `${combinedRoot.path}/${folderName}`;
  remapNodePaths(scanRoot, oldPrefix, newPrefix, folderName);

  for (const [key, file] of remapFileMapKeys(sourceFileMap, oldPrefix, newPrefix)) {
    targetFileMap.set(key, file);
  }

  combinedRoot.children.set(folderName, scanRoot);
}

/**
 * @param {{ root: object, fileCount: number, folderCount: number, localFileMap?: Map, combined?: boolean } | null} current
 * @param {{ root: object, fileCount: number, folderCount: number, localFileMap?: Map, combined?: boolean } | null} incoming
 */
export function mergeScanResults(current, incoming) {
  if (!incoming?.root) {
    return current ?? null;
  }
  if (!current?.root) {
    return incoming;
  }

  const fileMap = new Map();
  let combinedRoot;

  if (!current.combined) {
    combinedRoot = createNode(COMBINED_ROOT_NAME, COMBINED_ROOT_NAME, false);
    attachScanRoot(combinedRoot, current.root, current.localFileMap ?? new Map(), fileMap);
  } else {
    combinedRoot = current.root;
    for (const [key, file] of current.localFileMap ?? []) {
      fileMap.set(key, file);
    }
  }

  attachScanRoot(combinedRoot, incoming.root, incoming.localFileMap ?? new Map(), fileMap);
  aggregateSizes(combinedRoot);
  sortChildren(combinedRoot);

  return {
    root: combinedRoot,
    fileCount: combinedRoot.fileCount,
    folderCount: countFolders(combinedRoot),
    localFileMap: fileMap,
    combined: true,
  };
}
