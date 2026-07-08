import lodashSet from 'lodash.set';

import './critical.sass';

import SongBrowser from '../js/song_browser';
import GoogleAuthBar from '../js/google_auth_bar';
import Toast from '../js/toast';
import UrlImportDialog from '../js/url_import_dialog';
import debounce from '../js/debounce';
import { getSongBrowserQueryParams, setSongBrowserQueryParams } from '../js/song_browser_hash';
import { fetchMe, saveSong, createSong } from '../js/song_api_client';
import { initGoogleAuth, isSignedIn } from '../js/google_auth';
import {
  suggestFileNameFromChordPro,
  parseTitleFromChordPro,
  parseSubtitleFromChordPro,
} from '../js/song_naming';
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

async function formatChordSheetMarkup(chordSheet, config) {
  const chordsheetjs = await loadChordsheetjs();
  const parser = new chordsheetjs.ChordProParser();
  const song = parser.parse(chordSheet);
  const formatter = new chordsheetjs.HtmlDivFormatter(config);
  return { song, html: formatter.format(song) };
}

async function loadHeavyUi(isTablet) {
  const [
    { default: SongEditorToolbar },
    { default: FullscreenViewer },
  ] = await Promise.all([
    import('../js/song_editor_toolbar'),
    import('../js/fullscreen_viewer'),
    import('./main.sass'),
  ]);

  let chordSheetEditor = null;
  if (!isTablet) {
    const { default: ChordSheetEditor } = await import('../js/chord_sheet_editor');
    chordSheetEditor = new ChordSheetEditor('chordSheetEditor');
    chordSheetEditor.init();
  }

  return {
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
  driveFileId = null;
  driveFile = null;
  pendingFileName = null;
  canEditCurrentFile = false;
  isSaving = false;
  chordSheetEditor = null;
  toolbar = null;
  fullscreenViewer = null;
  pendingQueryParams = null;

  constructor() {
    this.songBrowser = new SongBrowser('songBrowser');
    this.googleAuth = new GoogleAuthBar('googleAuth');
    this.toast = new Toast('toast');
    this.urlImportDialog = new UrlImportDialog('importDialog');
  }

  async start() {
    this.urlImportDialog.onImported = (result) => this.handleImportedSong(result);

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
    this.updateViewState();
  }

  applyQueryParams() {
    const { chordSheet, driveFileId } = this.pendingQueryParams || {};

    this.driveFileId = driveFileId;

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
    this.toolbar.onViewClick = () => this.openView();
    this.toolbar.onImportClick = () => this.urlImportDialog.open();
    this.toolbar.onNewClick = () => this.newSong();

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
        if (this.driveFile) {
          this.songBrowser.setSelectedSongMeta({
            title: parseTitleFromChordPro(newChordSheet),
            name: this.driveFile.name,
          });
        }
        this.updateSaveState();
        this.debouncedRender();
      };
    }

    this.songBrowser.onSongSelected = async ({ file, content, title }) => {
      this.driveFile = file;
      this.driveFileId = file.id;
      this.chordSheet = content;
      this.savedChordSheet = content;
      this.chordSheetEditor.setValue(content);
      document.title = `${file.name} — ${songBrowserConfig.title}`;
      this.songBrowser.setSelectedSongMeta({
        name: file.name,
        title: title || parseTitleFromChordPro(content),
      });
      await this.refreshEditPermission();
      this.songBrowser.setCanManageFiles(this.canEditCurrentFile);
      this.render();
      this.updateSaveState();
      this.updateViewState();
    };

    this.songBrowser.onSongRenamed = ({ file }) => {
      if (this.driveFile?.id === file.id) {
        this.driveFile = file;
        document.title = `${file.name} — ${songBrowserConfig.title}`;
      }
      this.toast.show(`Renamed to ${file.name}`, 'success');
    };

    this.songBrowser.onSongDeleted = (fileId) => {
      if (this.driveFile?.id === fileId) {
        this.driveFile = null;
        this.driveFileId = null;
        this.chordSheet = '';
        this.savedChordSheet = '';
        this.chordSheetEditor.setValue('');
        document.title = songBrowserConfig.title;
        this.render();
        this.updateSaveState();
        this.updateViewState();
      }
      this.toast.show('Song moved to Google Drive bin', 'success');
    };

    this.googleAuth.onAuthChange = async () => {
      await this.refreshEditPermission();
      this.songBrowser.setCanManageFiles(this.canEditCurrentFile);
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

    if (!this.chordSheet.trim()) {
      return { enabled: false, reason: 'Open or import a song first' };
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

    if (!this.driveFile) {
      return { enabled: true, reason: 'Save new song to Google Drive' };
    }

    if (!this.isDirty()) {
      return { enabled: false, reason: 'No changes to save' };
    }

    return { enabled: true, reason: 'Save changes to Google Drive' };
  }

  handleImportedSong({ chordPro, title, suggestedFileName }) {
    this.driveFile = null;
    this.driveFileId = null;
    this.pendingFileName = suggestedFileName || suggestFileNameFromChordPro(chordPro);
    this.chordSheet = chordPro;
    this.savedChordSheet = chordPro;

    if (this.chordSheetEditor) {
      this.chordSheetEditor.setValue(chordPro);
    }

    document.title = `${title || 'Imported song'} — ${songBrowserConfig.title}`;
    void this.refreshEditPermission().then(() => {
      this.updateSaveState();
    });
    this.render();
    this.updateViewState();
    this.toast.show(`Imported “${title || 'song'}”. Edit if needed, then save to Drive.`, 'success');
  }

  newSong() {
    const template = '{title: }\n{artist: }\n\n';
    this.driveFile = null;
    this.driveFileId = null;
    this.pendingFileName = null;
    this.chordSheet = template;
    this.savedChordSheet = template;
    this.chordSheetEditor.setValue(template);
    document.title = `New song — ${songBrowserConfig.title}`;
    this.render();
    this.updateSaveState();
    this.updateViewState();
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

  updateViewState() {
    if (!this.toolbar) {
      return;
    }

    const enabled = Boolean(this.chordSheet);
    this.toolbar.setViewEnabled(
      enabled,
      enabled ? 'View formatted song' : 'Open a song from the library first',
    );
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

      if (this.driveFile) {
        await saveSong(this.driveFile.id, content);
      } else {
        const { file } = await createSong({
          content,
          name: suggestFileNameFromChordPro(content) || this.pendingFileName || 'new-song.pro',
          folderId: this.songBrowser.getCurrentFolderId(),
        });
        this.driveFile = file;
        this.driveFileId = file.id;
        this.pendingFileName = null;
        await this.songBrowser.refreshList();
      }

      this.chordSheet = content;
      this.savedChordSheet = content;
      this.songBrowser.setSelectedSongMeta({
        name: this.driveFile.name,
        title: parseTitleFromChordPro(content),
      });
      this.songBrowser.refreshListedSelectionMeta({
        title: parseTitleFromChordPro(content),
        subtitle: parseSubtitleFromChordPro(content),
        name: this.driveFile.name,
      });
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

  async openView() {
    if (!this.chordSheet) {
      return;
    }

    try {
      const { html } = await formatChordSheetMarkup(this.chordSheet, this.config);
      this.fullscreenViewer.open({
        title: this.driveFile?.name || songBrowserConfig.title,
        content: html,
        mode: 'html',
      });
    } catch (error) {
      this.toast.show(error.message || 'Could not render song.', 'error');
    }
  }

  async syncViewPreview() {
    if (!this.fullscreenViewer.isOpen || !this.chordSheet) {
      return;
    }

    try {
      const { html } = await formatChordSheetMarkup(this.chordSheet, this.config);
      this.fullscreenViewer.update({ content: html, mode: 'html' });
    } catch {
      // Keep the current view open if a keystroke briefly breaks parsing.
    }
  }

  render() {
    if (!this.toolbar) {
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
    this.updateViewState();

    if (!this.chordSheet) {
      return;
    }

    try {
      const { song } = await formatChordSheetMarkup(this.chordSheet, this.config);
      this.song = song;
      this.chordSheetEditor.resetError();
      await this.syncViewPreview();
    } catch (error) {
      const message = error.message || String(error);
      const location = error.location;
      console.error(message);
      if (location) {
        this.chordSheetEditor.showError(message, location);
      }
    }
  }

  updateQueryParams() {
    setSongBrowserQueryParams({
      chordSheet: this.chordSheet,
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
