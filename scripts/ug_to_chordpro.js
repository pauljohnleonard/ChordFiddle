``#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  htmlToChordPro,
  slugify,
  validateImportUrl,
} = require('../server/tab-import');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

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
  const safeUrl = validateImportUrl(url);
  const response = await fetch(safeUrl, {
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
  loadHtml,
};
