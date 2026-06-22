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
    ...splitTagValues(fields.tags),
  ];

  return {
    title: fields.title || null,
    artist: fields.artist || null,
    key: fields.key || null,
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
