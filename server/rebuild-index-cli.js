#!/usr/bin/env node
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { rebuildIndex } = require('./index-sync');
const songIndex = require('./song-index');

rebuildIndex()
  .then(() => {
    const status = songIndex.getIndexStatus();
    // eslint-disable-next-line no-console
    console.log(`Indexed ${status.songCount} songs.`);
    process.exit(0);
  })
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error('Index rebuild failed:', error.message);
    process.exit(1);
  });
