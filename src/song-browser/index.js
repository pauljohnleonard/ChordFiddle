import lodashSet from 'lodash.set';

import './critical.sass';

import SongBrowser from '../js/song_browser';
import GoogleAuthBar from '../js/google_auth_bar';
import Toast from '../js/toast';
import debounce from '../js/debounce';
import { getSongBrowserQueryParams, setSongBrowserQueryParams } from '../js/song_browser_hash';
import { fetchMe, saveSong } from '../js/song_api_client';
import { initGoogleAuth, isSignedIn } from '../js/google_auth';
import songBrowserConfig from '../../song-browser-config.json';

const SAVE_LABEL = songBrowserConfig.toolbar.saveSong;

let chordsheetjsModule = null;

function isTabletLayout() {
  return window.matchMedia('(max-width: 1024px)').matches;
}

function hideLoadingBanner() {
  const loading = document.getElementById('appLoading');
  if (loading) {
    loading.hidden = true;
  }
}

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

async function loadChordsheetjs() {
  if (!chordsheetjsModule) {
    chordsheetjsModule = (await import('chordsheetjs')).default;
  }
  return chordsheetjsModule;
}

async function loadHeavyUi(isTablet) {
  const [
    { default: ChordSheetViewer },
    { default: SongEditorToolbar },
    { default: FullscreenViewer },
  ] = await Promise.all([
    import('../js/chord_sheet_viewer'),
    import('../js/song_editor_toolbar'),
    import('../js/fullscreen_viewer'),
    import('./main.sass'),
  ]);

  let chordSheetEditor = null;
  if (!isTablet) {
    const { default: ChordSheetEditor } = await import('../js/chord_sheet_editor');
    chordSheetEditor = new ChordSheetEditor('chordSheetEditor');
  }

  return {
    chordSheetViewer: new ChordSheetViewer('chordSheetViewer'),
    toolbar: new SongEditorToolbar('toolbar'),
    fullscreenViewer: new FullscreenViewer('fullscreenViewer'),
    chordSheetEditor,
  };
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
  chordSheetEditor = null;
  chordSheetViewer = null;
  toolbar = null;
  fullscreenViewer = null;
  pendingQueryParams = null;

  constructor() {
    this.songBrowser = new SongBrowser('songBrowser');
    this.googleAuth = new GoogleAuthBar('googleAuth');
    this.toast = new Toast('toast');
  }

  async start() {
    this.songBrowser.configure({
      rootFolderId: 'root',
      allowedExtensions: songBrowserConfig.googleDrive.allowedExtensions,
    });

    this.pendingQueryParams = getSongBrowserQueryParams();

    void this.songBrowser.loadRoot();
    hideLoadingBanner();

    initGoogleAuth()
      .then(async () => {
        if (isSignedIn()) {
          await this.refreshEditPermission();
          this.updateSaveState();
        }
      })
      .catch(() => {});

    await this.initHeavyUi();
  }

  async initHeavyUi() {
    const isTablet = isTabletLayout();
    const heavyUi = await loadHeavyUi(isTablet);
    this.chordSheetViewer = heavyUi.chordSheetViewer;
    this.toolbar = heavyUi.toolbar;
    this.fullscreenViewer = heavyUi.fullscreenViewer;
    this.chordSheetEditor = heavyUi.chordSheetEditor || {
      getValue: () => this.chordSheet,
      setValue: (value) => { this.chordSheet = value; },
      resetError: () => {},
      showError: () => {},
    };

    this.applyQueryParams();
    this.render();
    this.addChangeListeners();
    this.updateSaveState();
  }

  applyQueryParams() {
    const { chordSheet, displayMode, driveFileId } = this.pendingQueryParams || {};

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
      if (isTabletLayout()) {
        this.chordSheet = transform(this.chordSheet);
        this.chordSheetEditor.setValue(this.chordSheet);
      } else {
        this.chordSheetEditor.transformChordSheet(transform);
        this.chordSheet = this.chordSheetEditor.getValue();
      }
      this.updateSaveState();
      this.debouncedRender();
    };

    this.toolbar.onSaveClick = () => this.saveCurrentSong();

    if (this.chordSheetEditor.onChordSheetChange !== undefined) {
      this.chordSheetEditor.onChordSheetChange = (newChordSheet) => {
        this.chordSheet = newChordSheet;
        this.updateSaveState();
        this.debouncedRender();
      };
    }

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
    if (!this.toolbar) {
      return;
    }

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
      await this.songBrowser.loadTags();
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
    if (!this.chordSheetViewer) {
      return;
    }

    const button = this.chordSheetViewer.element('fullscreen');
    if (button) {
      button.disabled = !this.chordSheet;
    }
  }

  render() {
    if (!this.chordSheetViewer) {
      return;
    }

    this.renderChordSheet();
    this.updateQueryParams();
  }

  debouncedRender = debounce(() => {
    this.syncChordSheetFromEditor();
    this.render();
    this.updateSaveState();
  }, 100);

  async renderChordSheet() {
    if (!this.chordSheet) {
      this.chordSheetViewer.element('outlet').innerHTML = '<p class="SongBrowserApp__placeholder">Select a song from the library.</p>';
      this.updateFullscreenButton();
      return;
    }

    try {
      const chordsheetjs = await loadChordsheetjs();
      const parser = new chordsheetjs.ChordProParser();
      this.song = parser.parse(this.chordSheet);
      this.chordSheetViewer.render(this.song, this.config);
      this.chordSheetEditor.resetError();
      this.syncFullscreenPreview();
    } catch (error) {
      const message = error.message || String(error);
      const location = error.location;
      console.error(message);
      if (location) {
        this.chordSheetEditor.showError(message, location);
      }
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

function showBootError(message) {
  hideLoadingBanner();
  const errorElement = document.getElementById('appBootError');
  if (errorElement) {
    errorElement.hidden = false;
    errorElement.textContent = message;
  }
}

try {
  new SongBrowserApp().start().catch((error) => {
    showBootError(error.message || 'Failed to start CheeseJam');
  });
} catch (error) {
  showBootError(error.message || 'Failed to start CheeseJam');
}
