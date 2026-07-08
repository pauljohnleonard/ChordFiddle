import queryString from 'query-string';
import { compress, decompress } from './string_compression';

function getRawQueryParams() {
  return queryString.parse(window.location.hash);
}

function setRawQueryParams(rawQueryParams) {
  window.location.hash = queryString.stringify(rawQueryParams);
}

export function setSongBrowserQueryParams({ chordSheet, driveFileId }) {
  const params = {
    chord_sheet: compress(chordSheet),
  };
  if (driveFileId) {
    params.drive_file_id = driveFileId;
  }
  setRawQueryParams(params);
}

export function getSongBrowserQueryParams() {
  const {
    chord_sheet: chordSheet,
    drive_file_id: driveFileId,
  } = getRawQueryParams();

  return {
    chordSheet: decompress(chordSheet),
    driveFileId: driveFileId || null,
  };
}
