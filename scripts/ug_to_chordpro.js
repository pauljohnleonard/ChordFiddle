#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

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
  const names = [...line.matchAll(/\[ch\]([^\[]+)\[\/ch\]/g)].map((match) => match[1]);
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

function commandExists(command) {
  try {
    execFileSync('command', ['-v', command], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function fetchWithWget(url) {
  return execFileSync('wget', ['-qO-', `--user-agent=${USER_AGENT}`, url], {
    encoding: 'utf8',
    maxBuffer: 25 * 1024 * 1024,
  });
}

function fetchWithCurl(url) {
  return execFileSync('curl', ['-fsSL', '-A', USER_AGENT, url], {
    encoding: 'utf8',
    maxBuffer: 25 * 1024 * 1024,
  });
}

async function fetchWithNode(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.text();
}

async function loadHtmlFromUrl(url) {
  const errors = [];

  if (commandExists('wget')) {
    try {
      return fetchWithWget(url);
    } catch (error) {
      errors.push(`wget: ${error.message}`);
    }
  }

  try {
    return await fetchWithNode(url);
  } catch (error) {
    errors.push(`fetch: ${error.message}`);
  }

  if (commandExists('curl')) {
    try {
      return fetchWithCurl(url);
    } catch (error) {
      errors.push(`curl: ${error.message}`);
    }
  }

  throw new Error(`Could not download ${url}\n${errors.join('\n')}`);
}

function isUrl(source) {
  return /^https?:\/\//i.test(source);
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'song';
}

function extractTabFromHtml(html) {
  const match = html.match(/class="js-store" data-content="([^"]+)"/);
  if (!match) {
    throw new Error('Could not find tab data in page. Save the page HTML or check the URL.');
  }

  const store = JSON.parse(decodeHtmlEntities(match[1]));
  const pageData = store?.store?.page?.data;
  const tabView = pageData?.tab_view;
  const tabMeta = pageData?.tab;
  const content = tabView?.wiki_tab?.content;

  if (!content) {
    throw new Error('No chord tab content found. This URL may not be a Chords tab.');
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

async function loadHtml(source) {
  if (isUrl(source)) {
    return loadHtmlFromUrl(source);
  }

  const filePath = path.resolve(source);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Input not found: ${source}`);
  }

  return fs.readFileSync(filePath, 'utf8');
}

function printUsage() {
  console.error(`Usage: ug-to-chordpro <ultimate-guitar-url-or-html-file> [-o output.pro]

Examples:
  yarn ug-to-chordpro "https://tabs.ultimate-guitar.com/tab/olivia-rodrigo/stupid-song-chords-6483686"
  yarn ug-to-chordpro stupid-song-chords-6483686 -o stupid-song.pro
`);
}

async function main(argv) {
  const args = argv.slice(2);
  if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
    printUsage();
    process.exit(args.length === 0 ? 1 : 0);
  }

  let outputPath = null;
  const positional = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '-o' || arg === '--output') {
      outputPath = args[i + 1];
      if (!outputPath) {
        throw new Error('Missing value for --output');
      }
      i += 1;
      continue;
    }
    positional.push(arg);
  }

  if (positional.length !== 1) {
    printUsage();
    process.exit(1);
  }

  const [source] = positional;
  const html = await loadHtml(source);
  const { title, chordPro } = htmlToChordPro(html);

  if (!outputPath) {
    outputPath = `${slugify(title)}.pro`;
  }

  fs.writeFileSync(outputPath, chordPro);
  console.log(`Wrote ${outputPath} (${title})`);
}

if (require.main === module) {
  main(process.argv).catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}

module.exports = {
  htmlToChordPro,
  convertUgMarkupToBody,
  extractTabFromHtml,
};
