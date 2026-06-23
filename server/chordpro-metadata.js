const ChordSheetJS = require('chordsheetjs').default;

const TAG_LINE_PATTERNS = [
  /^\{keywords:\s*(.+)\}\s*$/im,
  /^\{topic:\s*(.+)\}\s*$/im,
  /^\{x_sbp_tags:\s*(.+)\}\s*$/im,
  /^\{x_cheesejam_tags:\s*(.+)\}\s*$/im,
];

function splitTagValues(value) {
  if (!value) {
    return [];
  }

  return String(value)
    .split(/[,;]/)
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean);
}

function collectMetadataTags(fields) {
  const rawTags = fields.tags;
  if (!rawTags) {
    return [];
  }
  if (Array.isArray(rawTags)) {
    return rawTags.flatMap((entry) => splitTagValues(entry));
  }
  return splitTagValues(rawTags);
}

function extractExtraTags(content) {
  const tags = [];

  TAG_LINE_PATTERNS.forEach((pattern) => {
    const match = content.match(pattern);
    if (match) {
      tags.push(...splitTagValues(match[1]));
    }
  });

  return tags;
}

function sqlMetadataValue(value) {
  if (value == null) {
    return null;
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'string') {
    return value || null;
  }
  if (typeof value === 'number' || typeof value === 'bigint') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(sqlMetadataValue).filter(Boolean).join(', ') || null;
  }
  return String(value);
}

function parseChordProMetadata(content) {
  let parseError = null;
  let fields = {};

  try {
    const parser = new ChordSheetJS.ChordProParser();
    const song = parser.parse(content);
    fields = song.metadata?.metadata || {};
  } catch (error) {
    parseError = error.message;
  }

  const tags = [
    ...extractExtraTags(content),
    ...collectMetadataTags(fields),
  ];

  return {
    title: sqlMetadataValue(fields.title),
    artist: sqlMetadataValue(fields.artist),
    key: sqlMetadataValue(fields.key),
    capo: fields.capo != null ? String(fields.capo) : null,
    tempo: fields.tempo != null ? String(fields.tempo) : null,
    tags: [...new Set(tags)],
    parseError,
  };
}

module.exports = {
  parseChordProMetadata,
  splitTagValues,
};
