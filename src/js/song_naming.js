export function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function displaySongName(filename) {
  const lower = String(filename || '').toLowerCase();
  if (lower.endsWith('.chordpro')) {
    return filename.slice(0, -9);
  }
  if (lower.endsWith('.pro')) {
    return filename.slice(0, -4);
  }
  return filename;
}

export function getFileExtension(filename) {
  const lower = String(filename || '').toLowerCase();
  if (lower.endsWith('.chordpro')) {
    return filename.slice(-9);
  }
  if (lower.endsWith('.pro')) {
    return filename.slice(-4);
  }
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.slice(dot) : '.pro';
}

export function parseTitleFromChordPro(chordPro) {
  const match = String(chordPro || '').match(/\{title:\s*([^}\n]+?)\s*\}/i);
  return match?.[1]?.trim() || '';
}

export function parseSubtitleFromChordPro(chordPro) {
  const patterns = [
    /\{subtitle:\s*([^}\n]+?)\s*\}/i,
    /\{st:\s*([^}\n]+?)\s*\}/i,
  ];
  for (const pattern of patterns) {
    const match = String(chordPro || '').match(pattern);
    const value = match?.[1]?.trim();
    if (value) {
      return value;
    }
  }
  return '';
}

export function fileNameFromTitle(title, extension = '.pro') {
  const slug = slugify(title);
  return slug ? `${slug}${extension}` : null;
}

export function suggestFileNameFromChordPro(chordPro) {
  return fileNameFromTitle(parseTitleFromChordPro(chordPro));
}

export function getSongListLabel({ title, name }) {
  const trimmedTitle = title?.trim();
  if (trimmedTitle) {
    return trimmedTitle;
  }
  return displaySongName(name || '');
}

export function getSongSubtitleLine({ subtitle }) {
  const trimmed = subtitle?.trim();
  return trimmed || null;
}

export function getFileNameMeta({ title, name }) {
  if (!title?.trim() || !name) {
    return null;
  }

  const stripped = displaySongName(name);
  if (stripped.toLowerCase() === title.trim().toLowerCase()) {
    return null;
  }
  if (slugify(title) === stripped.toLowerCase()) {
    return null;
  }

  return stripped;
}

export function fileNameMatchesTitle(fileName, title) {
  return getFileNameMeta({ title, name: fileName }) === null;
}
