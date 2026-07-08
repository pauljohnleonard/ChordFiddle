const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function decodeHtmlEntities(value) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function chordGrid(line) {
  return line.replace(/\[ch\]([^\[]+)\[\/ch\]/g, '$1');
}

function mergeChordAndLyric(chordLine, lyricLine) {
  const grid = chordGrid(chordLine);
  const chords = [];
  const re = /\S+/g;
  let match;
  while ((match = re.exec(grid)) !== null) {
    chords.push({ pos: match.index, name: match[0] });
  }
  if (chords.length === 0) {
    return lyricLine.trim();
  }

  const inline = chords.filter((chord) => chord.pos < lyricLine.length);
  const trailing = chords.filter((chord) => chord.pos >= lyricLine.length);

  let result = lyricLine;
  inline.sort((a, b) => b.pos - a.pos);
  for (const { pos, name } of inline) {
    result = `${result.slice(0, pos)}[${name}]${result.slice(pos)}`;
  }

  result = result.trim();
  if (trailing.length) {
    result += `\n${trailing.map((chord) => `[${chord.name}]`).join(' ')}`;
  }
  return result;
}

function chordOnlyLine(line) {
  const names = [...line.matchAll(/\[ch\]([^\[]+)\[\/ch\]/g)].map((m) => m[1]);
  if (names.length) {
    return names.map((chord) => `[${chord}]`).join(' ');
  }

  const grid = chordGrid(line).trim();
  if (!grid) {
    return '';
  }
  return grid.split(/\s+/).map((chord) => `[${chord}]`).join(' ');
}

function convertLine(line) {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }
  if (/^\[[^\]]+\]$/.test(trimmed) && !trimmed.startsWith('[ch]')) {
    return trimmed;
  }
  if (/\[ch\]/.test(trimmed)) {
    return chordOnlyLine(trimmed);
  }
  return trimmed;
}

function convertUgMarkupToBody(source) {
  const output = [];
  const parts = source.split(/(\[tab\][\s\S]*?\[\/tab\])/);

  for (const part of parts) {
    if (!part) {
      continue;
    }

    if (part.startsWith('[tab]')) {
      const inner = part.slice(5, -6);
      const tabLines = inner.split('\n');
      if (tabLines.length === 1) {
        const grid = chordGrid(tabLines[0]).trim();
        const hasLyrics = /[a-z]{2,}/i.test(grid);
        if (hasLyrics) {
          output.push(grid);
        } else if (grid) {
          output.push(grid.split(/\s+/).map((chord) => `[${chord}]`).join(' '));
        }
      } else {
        output.push(mergeChordAndLyric(tabLines[0], tabLines.slice(1).join(' ').trim()));
      }
      continue;
    }

    for (const line of part.split('\n')) {
      const converted = convertLine(line);
      if (converted) {
        output.push(converted);
      }
    }
  }

  return output.join('\n');
}

function extractTabFromHtml(html) {
  const match = html.match(/class="js-store" data-content="([^"]+)"/);
  if (!match) {
    throw new Error('Could not find tab data on this page. Try a different URL or save the page HTML.');
  }

  const store = JSON.parse(decodeHtmlEntities(match[1]));
  const pageData = store?.store?.page?.data;
  const tabView = pageData?.tab_view;
  const tabMeta = pageData?.tab;
  const content = tabView?.wiki_tab?.content;

  if (!content) {
    throw new Error('No chord tab content found on this page.');
  }

  return {
    title: tabMeta?.song_name || tabView?.song_name || 'Untitled',
    artist: tabMeta?.artist_name || tabView?.artist_name || 'Unknown Artist',
    content,
  };
}

function htmlToChordPro(html) {
  const { title, artist, content } = extractTabFromHtml(html);
  const body = convertUgMarkupToBody(content);
  return {
    title,
    artist,
    chordPro: `{title: ${title}}\n{artist: ${artist}}\n\n${body}\n`,
  };
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'song';
}

function validateImportUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Enter a valid http or https URL.');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only http and https URLs are supported.');
  }

  return parsed.toString();
}

async function fetchUrlHtml(url) {
  const safeUrl = validateImportUrl(url);
  const response = await fetch(safeUrl, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new Error(`Could not download page (HTTP ${response.status}).`);
  }

  return response.text();
}

async function importFromUrl(url) {
  const html = await fetchUrlHtml(url);
  const result = htmlToChordPro(html);
  return {
    ...result,
    suggestedFileName: `${slugify(result.title)}.pro`,
  };
}

module.exports = {
  convertUgMarkupToBody,
  extractTabFromHtml,
  htmlToChordPro,
  importFromUrl,
  slugify,
  validateImportUrl,
};
