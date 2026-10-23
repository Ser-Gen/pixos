// What a file is, by its extension, and the colours each kind is drawn in.
//
// Nine kinds rather than a hue per extension: a map of a disk is read by "what sort of thing is
// eating it", and forty hues cannot be told apart or put in a legend. Magenta is left out on
// purpose — as in Explorer, it means "this one" (the rect under the pointer) and nothing else.

export const KINDS = [
  { id: 'code', label: 'Code', hue: 150 },
  { id: 'data', label: 'Data', hue: 185 },
  { id: 'document', label: 'Documents', hue: 215 },
  { id: 'image', label: 'Images', hue: 265 },
  { id: 'video', label: 'Video', hue: 15 },
  { id: 'audio', label: 'Audio', hue: 45 },
  { id: 'archive', label: 'Archives', hue: 85 },
  { id: 'binary', label: 'Binaries', hue: 205, grey: true },
  { id: 'other', label: 'Other', hue: 160, grey: true },
];

export const EXTENSIONS = {
  code: 'js mjs cjs ts tsx jsx vue svelte css scss sass less html htm php py rb go rs java kt swift c h cc cpp hpp cs m sh bash zsh ps1 bat lua pl r dart scala clj ex exs erl hs ml glsl wgsl frag vert',
  data: 'json jsonl xml yaml yml toml ini cfg conf csv tsv sql db sqlite sqlite3 parquet avro ndjson map lock env plist',
  document: 'md markdown txt log rtf pdf doc docx odt xls xlsx ods ppt pptx odp epub fb2 djvu mobi tex rst org',
  image: 'png jpg jpeg gif webp avif bmp ico svg tif tiff heic heif psd xcf raw cr2 nef dng exr hdr',
  video: 'mp4 m4v mov mkv webm avi wmv flv ogv mpg mpeg 3gp',
  audio: 'mp3 m4a aac wav flac ogg oga opus weba wma aiff mid midi',
  archive: 'zip 7z rar tar gz tgz bz2 xz zst lz lzma cab iso img dmg jar war apk deb rpm',
  binary: 'wasm exe dll so dylib bin dat o a lib class pyc node woff woff2 ttf otf eot pak',
};

const KIND_OF_EXTENSION = new Map();
for (const [kind, list] of Object.entries(EXTENSIONS)) {
  for (const ext of list.split(' ')) {
    KIND_OF_EXTENSION.set(ext, kind);
  }
}

export function extensionOf(name) {
  const dot = name.lastIndexOf('.');
  // No dot, or only a leading one (`.bashrc`), is no extension; a trailing one leaves nothing after it.
  if (dot <= 0) return '';
  return name.slice(dot + 1).toLowerCase();
}

export function kindOf(name) {
  return KIND_OF_EXTENSION.get(extensionOf(name)) || 'other';
}

// fill: the body of a rect; edge: its lit top line; ink and dim: its name and its size; swatch:
// the legend. Dark fills, so a label in the kind's own light ink reads on every one of them; the
// two greys keep a trace of hue so they sit with the rest instead of looking unpainted.
function paint(kind) {
  const hsl = (s, l) => `hsl(${kind.hue}, ${kind.grey ? Math.min(s, 10) : s}%, ${l}%)`;
  return {
    fill: hsl(34, 19),
    edge: hsl(42, 31),
    ink: hsl(62, 82),
    dim: hsl(30, 60),
    swatch: hsl(48, 46),
  };
}

export const PAINT = Object.fromEntries(KINDS.map((kind) => [kind.id, paint(kind)]));
export const LABEL = Object.fromEntries(KINDS.map((kind) => [kind.id, kind.label]));
