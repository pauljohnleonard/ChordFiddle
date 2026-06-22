import chordsheetjs from 'chordsheetjs';
import lodashSet from 'lodash.set';

import './main.sass';

import ChordSheetEditor from '../js/chord_sheet_editor';
import ChordSheetViewer from '../js/chord_sheet_viewer';
import SongEditorToolbar from '../js/song_editor_toolbar';
import SongBrowser from '../js/song_browser';
import GoogleAuthBar from '../js/google_auth_bar';
import Toast from '../js/toast';
import debounce from '../js/debounce';
import { getSongBrowserQueryParams, setSongBrowserQueryParams } from '../js/song_browser_hash';
import { fetchMe, saveSong } from '../js/song_api_client';
import { initGoogleAuth, isSignedIn } from '../js/google_auth';
import FullscreenViewer from '../js/fullscreen_viewer';
import songBrowserConfig from '../../song-browser-config.json';

const SAVE_LABEL = songBrowserConfig.toolbar.saveSong;

function defaultFormatterConfig(formatterConfig) {
  const config = {};

  function walk(attributes, prefix = '') {
    Object.entries(attributes).forEach(([key, node]) => {
      if (node.type === 'object' && node.attributes) {
        walk(node.attributes, `${prefix}${key}.`);
      } else if ('value' in node) {
        lodashSet(config, `${prefix}${key}`, node.value);
      }
    });
  }

  walk(formatterConfig.attributes);
  return config;
}

class SongBrowserApp {
  song;
  chordSheet = '';
  savedChordSheet = '';
  config = defaultFormatterConfig(songBrowserConfig.formatterConfig);
  displayMode;
  driveFileId = null;
  driveFile = null;
  canEditCurrentFile = false;
  isSaving = false;

  constructor() {
    this.chordSheetEditor = new ChordSheetEditor('chordSheetEditor');
    this.chordSheetViewer = new ChordSheetViewer('chordSheetViewer');
    this.toolbar = new SongEditorToolbar('toolbar');
    this.songBrowser = new SongBrowser('songBrowser');
    this.googleAuth = new GoogleAuthBar('googleAuth');
    this.toast = new Toast('toast');
    this.fullscreenViewer = new FullscreenViewer('fullscreenViewer');
  }

  async start() {
    this.songBrowser.configure({
      rootFolderId: 'root',
      allowedExtensions: songBrowserConfig.googleDrive.allowedExtensions,
    });

    this.syncWithQueryParams();
    this.render();
    this.addChangeListeners();
    await initGoogleAuth();
    if (isSignedIn()) {
      await this.refreshEditPermission();
    }
    this.songBrowser.loadRoot();
    this.updateSaveState();
  }

  syncWithQueryParams() {
    const { chordSheet, displayMode, driveFileId } = getSongBrowserQueryParams();

    this.driveFileId = driveFileId;

    if (displayMode) {
      this.displayMode = displayMode;
      this.chordSheetViewer.setSelectedMode(displayMode);
    } else {
      this.displayMode = this.chordSheetViewer.getSelectedMode();
    }

    if (chordSheet) {
      this.chordSheet = chordSheet;
      this.savedChordSheet = chordSheet;
      this.chordSheetEditor.setValue(chordSheet);
    } else if (driveFileId) {
      this.songBrowser.selectFileById(driveFileId);
    } else {
      this.chordSheet = this.chordSheetEditor.getValue();
      this.savedChordSheet = this.chordSheet;
    }
  }

  addChangeListeners() {
    this.chordSheetViewer.onDisplayModeChanged = (displayMode) => {
      this.displayMode = displayMode;
      this.render();
    };

    this.chordSheetViewer.onFullscreenClick = () => this.openFullscreen();

    this.toolbar.onTransformClick = (transform) => {
      this.chordSheetEditor.transformChordSheet(transform);
      this.chordSheet = this.chordSheetEditor.getValue();
      this.updateSaveState();
      this.debouncedRender();
    };

    this.toolbar.onSaveClick = () => this.saveCurrentSong();

    this.chordSheetEditor.onChordSheetChange = (newChordSheet) => {
      this.chordSheet = newChordSheet;
      this.updateSaveState();
      this.debouncedRender();
    };

    this.songBrowser.onSongSelected = async ({ file, content }) => {
      this.driveFile = file;
      this.driveFileId = file.id;
      this.chordSheet = content;
      this.savedChordSheet = content;
      this.chordSheetEditor.setValue(content);
      document.title = `${file.name} — ${songBrowserConfig.title}`;
      await this.refreshEditPermission();
      this.render();
      this.updateSaveState();
    };

    this.googleAuth.onAuthChange = async () => {
      await this.refreshEditPermission();
      this.updateSaveState();
    };
  }

  async refreshEditPermission() {
    if (!isSignedIn()) {
      this.canEditCurrentFile = false;
      return;
    }

    try {
      const me = await fetchMe();
      this.canEditCurrentFile = me.canEdit;
    } catch {
      this.canEditCurrentFile = false;
    }
  }

  isDirty() {
    if (!this.driveFile) {
      return false;
    }
    return this.chordSheetEditor.getValue() !== this.savedChordSheet;
  }

  syncChordSheetFromEditor() {
    this.chordSheet = this.chordSheetEditor.getValue();
  }

  getSaveState() {
    if (this.isSaving) {
      return { enabled: false, reason: 'Saving…' };
    }

    if (!this.driveFile) {
      return { enabled: false, reason: 'Open a song from the library first' };
    }

    if (!isSignedIn()) {
      return { enabled: false, reason: 'Sign in with Google to save' };
    }

    if (!this.canEditCurrentFile) {
      return {
        enabled: false,
        reason: 'View only — you need Editor access on the song library folder',
      };
    }

    if (!this.isDirty()) {
      return { enabled: false, reason: 'No changes to save' };
    }

    return { enabled: true, reason: 'Save changes to Google Drive' };
  }

  updateSaveState() {
    const { enabled, reason } = this.getSaveState();
    this.toolbar.setSaveEnabled(enabled, reason);

    if (!this.isSaving) {
      this.toolbar.resetSaveLabel(SAVE_LABEL);
    }
  }

  async saveCurrentSong() {
    const { enabled } = this.getSaveState();
    if (!enabled) {
      return;
    }

    this.isSaving = true;
    this.toolbar.setSaveStatus('Saving…');
    this.updateSaveState();

    try {
      const content = this.chordSheetEditor.getValue();
      await saveSong(this.driveFile.id, content);
      this.chordSheet = content;
      this.savedChordSheet = content;
      this.toast.show(`Saved to Google Drive: ${this.driveFile.name}`, 'success');
    } catch (error) {
      this.toast.show(error.message || 'Failed to save to Google Drive.', 'error');
    } finally {
      this.isSaving = false;
      this.toolbar.resetSaveLabel(SAVE_LABEL);
      this.updateSaveState();
    }
  }

  openFullscreen() {
    if (!this.chordSheet) {
      return;
    }

    const outlet = this.chordSheetViewer.element('outlet');
    const mode = this.chordSheetViewer.getSelectedMode();
    const content = mode === 'text' ? outlet.innerText : outlet.innerHTML;

    this.fullscreenViewer.open({
      title: this.driveFile?.name || songBrowserConfig.title,
      content,
      mode,
    });
  }

  syncFullscreenPreview() {
    if (!this.fullscreenViewer.isOpen) {
      return;
    }

    const outlet = this.chordSheetViewer.element('outlet');
    const mode = this.chordSheetViewer.getSelectedMode();
    const content = mode === 'text' ? outlet.innerText : outlet.innerHTML;
    this.fullscreenViewer.update({ content, mode });
  }

  updateFullscreenButton() {
    const button = this.chordSheetViewer.element('fullscreen');
    if (button) {
      button.disabled = !this.chordSheet;
    }
  }

  render() {
    this.renderChordSheet();
    this.updateQueryParams();
  }

  debouncedRender = debounce(() => {
    this.syncChordSheetFromEditor();
    this.render();
    this.updateSaveState();
  }, 100);

  renderChordSheet() {
    if (!this.chordSheet) {
      this.chordSheetViewer.element('outlet').innerHTML = '<p class="SongBrowserApp__placeholder">Select a song from the library.</p>';
      this.updateFullscreenButton();
      return;
    }

    try {
      const parser = new chordsheetjs.ChordProParser();
      this.song = parser.parse(this.chordSheet);
      this.chordSheetViewer.render(this.song, this.config);
      this.chordSheetEditor.resetError();
      this.syncFullscreenPreview();
    } catch ({ message, location }) {
      console.error(message);
      this.chordSheetEditor.showError(message, location);
    }

    this.updateFullscreenButton();
  }

  updateQueryParams() {
    setSongBrowserQueryParams({
      chordSheet: this.chordSheet,
      displayMode: this.displayMode,
      driveFileId: this.driveFileId,
    });
  }
}

new SongBrowserApp().start();
