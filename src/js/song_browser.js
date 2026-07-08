import Component from './component';
import debounce from './debounce';
import {
  checkApiHealth,
  listAllFolderContents,
  loadSong,
  fetchTags,
  searchSongs,
  getIndexStatus,
  renameSong,
  deleteSong,
} from './song_api_client';
import {
  displaySongName,
  getSongListLabel,
  getFileNameMeta,
  fileNameMatchesTitle,
  fileNameFromTitle,
  getFileExtension,
} from './song_naming';

const INDEX_POLL_MS = 3000;
const INDEX_POLL_IDLE_MS = 30000;

function formatRelativeTime(isoDate) {
  if (!isoDate) {
    return null;
  }

  const then = new Date(isoDate).getTime();
  const seconds = Math.round((Date.now() - then) / 1000);

  if (seconds < 10) {
    return 'just now';
  }
  if (seconds < 60) {
    return `${seconds}s ago`;
  }

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  return new Date(isoDate).toLocaleString();
}

class SongBrowser extends Component {
  onSongSelected = () => {};
  onSongRenamed = () => {};
  onSongDeleted = () => {};

  rootFolderId = 'root';
  allowedExtensions = [];
  currentFolderId = '';
  folderStack = [];
  selectedFileId = null;
  selectedFileName = null;
  selectedFileTitle = null;
  canManageFiles = false;
  searchQuery = '';
  selectedTag = '';
  searchScope = 'folder';
  availableTags = [];
  filterActive = false;
  indexPollTimer = null;
  lastSyncInProgress = false;
  indexPollIntervalMs = INDEX_POLL_MS;

  setup() {
    this.listElement = this.element('list');
    this.statusElement = this.element('status');
    this.indexStatusElement = this.element('indexStatus');
    this.breadcrumbElement = this.element('breadcrumb');
    this.searchInput = this.element('search');
    this.tagsElement = this.element('tags');
    this.scopeElement = this.element('scope');
    this.clearButton = this.element('clearButton');
    this.renameButton = this.element('renameButton');
    this.deleteButton = this.element('deleteButton');
    this.matchTitleButton = this.element('matchTitleButton');
    this.selectionLabelElement = this.element('selectionLabel');
    // super() calls setup() before subclass field initializers run.
    this.folderStack = [];

    this.onClick('backButton', () => this.navigateUp());
    this.onClick('clearButton', () => this.clearFilters());
    this.onClick('renameButton', () => this.renameSelectedFile());
    this.onClick('deleteButton', () => this.deleteSelectedFile());
    this.onClick('matchTitleButton', () => this.matchFileNameToTitle());

    this.updateFilterUi();
    this.updateFileActionButtons();

    this.searchInput.addEventListener('input', debounce(() => {
      this.searchQuery = this.searchInput.value.trim();
      this.refreshList();
    }, 250));

    this.scopeElement.addEventListener('change', () => {
      this.syncSearchScopeFromDom();
      if (this.isFilterActive()) {
        this.refreshList();
      }
    });
  }

  configure({ rootFolderId, allowedExtensions }) {
    this.rootFolderId = rootFolderId || 'root';
    this.allowedExtensions = allowedExtensions;
    this.currentFolderId = rootFolderId;
    this.folderStack = [];
  }

  setCanManageFiles(canManage) {
    this.canManageFiles = Boolean(canManage);
    this.updateFileActionButtons();
  }

  setSelectedSongMeta({ title, name } = {}) {
    if (name !== undefined) {
      this.selectedFileName = name;
    }
    if (title !== undefined) {
      this.selectedFileTitle = title;
    }
    this.updateFileActionButtons();
  }

  updateFileActionButtons() {
    const hasSelection = Boolean(this.selectedFileId);
    const enabled = this.canManageFiles && hasSelection;
    const title = this.selectedFileTitle?.trim();
    const canMatchTitle = enabled
      && Boolean(title)
      && this.selectedFileName
      && !fileNameMatchesTitle(this.selectedFileName, title);

    if (this.renameButton) {
      this.renameButton.disabled = !enabled;
      this.renameButton.title = enabled
        ? 'Rename selected song'
        : 'Sign in with Editor access and select a song';
    }

    if (this.deleteButton) {
      this.deleteButton.disabled = !enabled;
      this.deleteButton.title = enabled
        ? 'Move selected song to Google Drive bin'
        : 'Sign in with Editor access and select a song';
    }

    if (this.matchTitleButton) {
      this.matchTitleButton.disabled = !canMatchTitle;
      this.matchTitleButton.title = canMatchTitle
        ? `Rename file to match “${title}”`
        : enabled && title
          ? 'Filename already matches title'
          : 'Select a song with a {title: …} field';
    }

    this.updateSelectionLabel();
  }

  refreshListedSelectionMeta({ title, subtitle, name } = {}) {
    if (!this.selectedFileId) {
      return;
    }

    if (name !== undefined) {
      this.selectedFileName = name;
    }
    if (title !== undefined) {
      this.selectedFileTitle = title;
    }

    this.updateListedSong(this.selectedFileId, {
      title: this.selectedFileTitle,
      subtitle,
      name: this.selectedFileName,
    });
    this.updateFileActionButtons();
  }

  updateSelectionLabel() {
    if (!this.selectionLabelElement) {
      return;
    }

    if (!this.selectedFileId) {
      this.selectionLabelElement.textContent = 'Select a song to rename or delete';
      return;
    }

    this.selectionLabelElement.textContent = getSongListLabel({
      title: this.selectedFileTitle,
      name: this.selectedFileName,
    });
  }

  getCurrentFolderId() {
    return this.currentFolderId || this.rootFolderId;
  }

  async loadRoot() {
    try {
      const health = await checkApiHealth();
      if (!health.driveConfigured) {
        this.setStatus('Server is missing DRIVE_FOLDER_ID. Check .env and restart the API.');
        return;
      }
    } catch {
      this.setStatus('Cannot reach the song API. Run yarn start:api in another terminal.');
      return;
    }

    this.currentFolderId = this.rootFolderId;
    this.folderStack = [];
    this.startIndexPolling();
    await this.loadTags();
    await this.pollIndexStatus();
    await this.loadCurrentFolder();
  }

  startIndexPolling() {
    this.stopIndexPolling();
    this.indexPollTimer = setInterval(() => {
      this.pollIndexStatus();
    }, this.indexPollIntervalMs);
  }

  stopIndexPolling() {
    if (this.indexPollTimer) {
      clearInterval(this.indexPollTimer);
      this.indexPollTimer = null;
    }
  }

  setIndexPollInterval(ms) {
    this.indexPollIntervalMs = ms;
    if (this.indexPollTimer) {
      this.startIndexPolling();
    }
  }

  async pollIndexStatus() {
    try {
      const status = await getIndexStatus();
      const wasSyncing = this.lastSyncInProgress;
      this.lastSyncInProgress = status.syncInProgress;
      this.renderIndexStatus(status);

      const nextInterval = status.syncInProgress ? INDEX_POLL_MS : INDEX_POLL_IDLE_MS;
      if (nextInterval !== this.indexPollIntervalMs) {
        this.setIndexPollInterval(nextInterval);
      }

      if (wasSyncing && !status.syncInProgress) {
        await this.loadTags();
      }
    } catch {
      this.indexStatusElement.textContent = 'Index status unavailable';
      this.indexStatusElement.classList.add('SongBrowser__index-status--error');
    }
  }

  renderIndexStatus(status) {
    const {
      songCount,
      lastSyncAt,
      syncInProgress,
      syncPhase,
      syncCurrentPath,
      lastSyncError,
    } = status;

    this.indexStatusElement.classList.remove(
      'SongBrowser__index-status--syncing',
      'SongBrowser__index-status--error',
      'SongBrowser__index-status--ready',
    );

    if (lastSyncError && !syncInProgress) {
      this.indexStatusElement.textContent = `Index error: ${lastSyncError}`;
      this.indexStatusElement.classList.add('SongBrowser__index-status--error');
      return;
    }

    if (syncInProgress) {
      const phaseLabel = syncPhase === 'changes' ? 'Syncing' : 'Indexing';
      const location = syncCurrentPath ? ` · ${syncCurrentPath}` : '';
      this.indexStatusElement.textContent = `${phaseLabel}… ${songCount} song${songCount === 1 ? '' : 's'}${location}`;
      this.indexStatusElement.classList.add('SongBrowser__index-status--syncing');
      return;
    }

    const updated = formatRelativeTime(lastSyncAt);
    const updatedLabel = updated ? ` · updated ${updated}` : '';
    this.indexStatusElement.textContent = `${songCount} song${songCount === 1 ? '' : 's'} indexed${updatedLabel}`;
    this.indexStatusElement.classList.add('SongBrowser__index-status--ready');
  }

  async loadTags() {
    try {
      const { tags } = await fetchTags();
      this.availableTags = tags || [];
      this.renderTags();
    } catch {
      this.availableTags = [];
      this.tagsElement.hidden = true;
    }
  }

  renderTags() {
    this.tagsElement.innerHTML = '';

    if (this.availableTags.length === 0) {
      this.tagsElement.hidden = true;
      return;
    }

    this.tagsElement.hidden = false;
    this.availableTags.forEach(({ tag, count }) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'SongBrowser__tag';
      if (tag === this.selectedTag) {
        chip.classList.add('SongBrowser__tag--selected');
      }
      chip.textContent = `${tag} (${count})`;
      chip.addEventListener('click', () => {
        this.selectedTag = this.selectedTag === tag ? '' : tag;
        if (this.selectedTag) {
          this.setSearchScope('all');
        }
        this.renderTags();
        this.refreshList();
      });
      this.tagsElement.appendChild(chip);
    });
  }

  syncSearchScopeFromDom() {
    const selected = this.scopeElement.querySelector('input[name="songBrowserScope"]:checked');
    this.searchScope = selected?.value || 'all';
  }

  setSearchScope(scope) {
    this.searchScope = scope;
    const radio = this.scopeElement.querySelector(`input[name="songBrowserScope"][value="${scope}"]`);
    if (radio) {
      radio.checked = true;
    }
  }

  isFilterActive() {
    return Boolean(this.searchQuery || this.selectedTag);
  }

  updateFilterUi() {
    this.filterActive = this.isFilterActive();
    if (this.clearButton) {
      this.clearButton.hidden = !this.filterActive;
    }
    const backButton = this.element('backButton');
    if (backButton) {
      backButton.disabled = this.filterActive || this.folderStack.length === 0;
    }
  }

  clearFilters() {
    this.searchQuery = '';
    this.selectedTag = '';
    this.searchInput.value = '';
    this.renderTags();
    this.refreshList();
    this.updateFilterUi();
  }

  async refreshList() {
    if (this.isFilterActive()) {
      await this.loadSearchResults();
    } else {
      await this.loadCurrentFolder();
    }
  }

  async loadSearchResults() {
    this.syncSearchScopeFromDom();
    this.updateFilterUi();
    this.setStatus('Searching…');
    this.listElement.innerHTML = '';

    try {
      const results = await searchSongs({
        q: this.searchQuery,
        tag: this.selectedTag,
        folderId: this.currentFolderId,
        scope: this.searchScope,
        limit: 200,
      });

      const songs = results?.songs ?? [];
      const total = results?.total ?? songs.length;

      this.renderBreadcrumb(true, total);
      this.renderSearchResults(songs);

      if (songs.length === 0) {
        this.setStatus('No songs match your search.');
      } else if (total > songs.length) {
        this.setStatus(`Showing ${songs.length} of ${total} songs.`);
      } else {
        this.setStatus('');
      }
    } catch (error) {
      this.handleError(error);
    }
  }

  async loadCurrentFolder() {
    this.updateFilterUi();
    this.setStatus('Loading songs…');
    this.listElement.innerHTML = '';

    try {
      const data = await listAllFolderContents(this.currentFolderId);
      const folders = data?.folders ?? [];
      const files = data?.files ?? [];
      const skipped = data?.skipped ?? [];

      this.renderBreadcrumb(false);
      this.renderEntries(folders, files);

      if (folders.length === 0 && files.length === 0) {
        this.setStatus(this.emptyFolderMessage(skipped));
      } else {
        this.setStatus('');
      }
    } catch (error) {
      this.handleError(error);
    }
  }

  emptyFolderMessage(skipped = []) {
    const items = skipped ?? [];

    if (items.length === 0) {
      return 'Drive returned no files here. If your .pro songs are inside a subfolder, open a [dir] folder above.';
    }

    const examples = items.slice(0, 3).map((file) => `${file.name} (${file.mimeType})`).join(', ');
    return `No .pro or supported songs found. Drive has ${items.length} other item(s): ${examples}${items.length > 3 ? '…' : ''}`;
  }

  handleError(error) {
    if (error.status === 403) {
      this.setStatus('Cannot access folder. Share it with the service account as Editor.');
      return;
    }
    this.setStatus(error.message || 'Failed to load folder from Google Drive.');
  }

  renderBreadcrumb(isSearch, resultCount = 0) {
    if (isSearch) {
      const scopeLabel = this.searchScope === 'all' ? 'all songs' : 'this folder';
      this.breadcrumbElement.textContent = `Search · ${scopeLabel} · ${resultCount} result${resultCount === 1 ? '' : 's'}`;
      return;
    }

    const parts = ['Songs', ...this.folderStack.map((folder) => folder.name)];
    this.breadcrumbElement.textContent = parts.join(' / ');
  }

  renderSearchResults(songs = []) {
    songs.forEach((song) => {
      const item = this.createSongListItem({
        fileId: song.fileId,
        title: song.title,
        subtitle: song.subtitle,
        name: song.name,
        folderPath: song.folderPath,
      });
      if (song.fileId === this.selectedFileId) {
        item.classList.add('SongBrowser__item--selected');
      }
      item.addEventListener('click', () => this.selectFileById(
        song.fileId,
        song.name,
        song.title,
      ));
      this.listElement.appendChild(item);
    });
  }

  renderEntries(folders = [], files = []) {
    folders.forEach((folder) => {
      const item = this.createListItem(folder.name, 'folder');
      item.addEventListener('click', () => this.navigateInto(folder));
      this.listElement.appendChild(item);
    });

    const sortedFiles = [...files].sort((a, b) => (
      getSongListLabel(a).localeCompare(getSongListLabel(b), undefined, { sensitivity: 'base' })
    ));

    sortedFiles.forEach((file) => {
      const item = this.createSongListItem({
        fileId: file.id,
        title: file.title,
        subtitle: file.subtitle,
        name: file.name,
      });
      if (file.id === this.selectedFileId) {
        item.classList.add('SongBrowser__item--selected');
      }
      item.addEventListener('click', () => this.selectFile(file));
      this.listElement.appendChild(item);
    });
  }

  createSongListItem({ fileId, title, subtitle, name, folderPath }) {
    const item = this.createListItem(getSongListLabel({ title, name }), 'file');
    if (fileId) {
      item.dataset.fileId = fileId;
    }
    const trimmedSubtitle = subtitle?.trim();
    if (trimmedSubtitle) {
      this.appendListItemSubtitle(item, trimmedSubtitle);
    }
    const fileMeta = getFileNameMeta({ title, name });
    if (fileMeta) {
      this.appendListItemMeta(item, fileMeta);
    }
    if (folderPath) {
      this.appendListItemMeta(item, folderPath);
    }
    return item;
  }

  updateListSelection() {
    this.listElement.querySelectorAll('[data-file-id]').forEach((item) => {
      item.classList.toggle(
        'SongBrowser__item--selected',
        item.dataset.fileId === this.selectedFileId,
      );
    });
  }

  removeListedSong(fileId) {
    const item = this.listElement.querySelector(`[data-file-id="${fileId}"]`);
    item?.remove();
  }

  updateListedSong(fileId, { title, subtitle, name }) {
    const item = this.listElement.querySelector(`[data-file-id="${fileId}"]`);
    if (!item) {
      return;
    }

    const label = item.querySelector('.SongBrowser__item-label');
    if (label) {
      label.textContent = getSongListLabel({ title, name });
    }

    item.querySelectorAll('.SongBrowser__item-subtitle, .SongBrowser__item-meta').forEach((line) => {
      line.remove();
    });
    const trimmedSubtitle = subtitle?.trim();
    if (trimmedSubtitle) {
      this.appendListItemSubtitle(item, trimmedSubtitle);
    }
    const fileMeta = getFileNameMeta({ title, name });
    if (fileMeta) {
      this.appendListItemMeta(item, fileMeta);
    }
  }

  appendListItemSubtitle(item, text) {
    const subtitle = document.createElement('span');
    subtitle.className = 'SongBrowser__item-subtitle';
    subtitle.textContent = text;
    item.appendChild(subtitle);
  }

  appendListItemMeta(item, text) {
    const meta = document.createElement('span');
    meta.className = 'SongBrowser__item-meta';
    meta.textContent = text;
    item.appendChild(meta);
  }

  createListItem(name, type) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = `SongBrowser__item SongBrowser__item--${type}`;
    const label = document.createElement('span');
    label.className = 'SongBrowser__item-label';
    label.textContent = name;
    item.appendChild(label);
    return item;
  }

  async navigateInto(folder) {
    if (this.isFilterActive()) {
      return;
    }

    this.folderStack.push({ id: this.currentFolderId, name: folder.name });
    this.currentFolderId = folder.id;
    await this.loadCurrentFolder();
  }

  async navigateUp() {
    if (this.isFilterActive() || this.folderStack.length === 0) {
      return;
    }

    const parent = this.folderStack.pop();
    this.currentFolderId = parent.id;
    await this.loadCurrentFolder();
  }

  async selectFile(file) {
    if (this.selectedFileId === file.id) {
      return;
    }

    this.selectedFileId = file.id;
    this.selectedFileName = file.name;
    this.selectedFileTitle = file.title || null;
    this.updateFileActionButtons();
    this.updateListSelection();
    this.setStatus(`Loading ${getSongListLabel({ title: file.title, name: file.name })}…`);

    try {
      const { file: metadata, content, title } = await loadSong(file.id);
      this.selectedFileTitle = title || file.title || null;
      this.updateFileActionButtons();
      this.onSongSelected({ file: metadata, content, title: this.selectedFileTitle });
      this.setStatus('');
    } catch (error) {
      this.handleError(error);
    }
  }

  async selectFileById(fileId, name = 'song', title = null) {
    if (this.selectedFileId === fileId) {
      return;
    }

    this.selectedFileId = fileId;
    this.selectedFileName = name;
    this.selectedFileTitle = title;
    this.updateFileActionButtons();
    this.updateListSelection();
    this.setStatus(`Loading ${getSongListLabel({ title, name })}…`);

    try {
      const { file: metadata, content, title: indexTitle } = await loadSong(fileId);
      this.selectedFileTitle = indexTitle || title || null;
      this.updateFileActionButtons();
      this.onSongSelected({ file: metadata, content, title: this.selectedFileTitle });
      this.setStatus('');
    } catch (error) {
      this.handleError(error);
    }
  }

  setStatus(message) {
    if (!this.statusElement) {
      return;
    }

    const text = message || '';
    this.statusElement.textContent = text;
    this.statusElement.hidden = !text;
  }

  async renameSelectedFile() {
    if (!this.canManageFiles || !this.selectedFileId || !this.selectedFileName) {
      return;
    }

    const currentLabel = getSongListLabel({
      title: this.selectedFileTitle,
      name: this.selectedFileName,
    });
    const nextName = window.prompt('Rename song', currentLabel);
    if (nextName === null) {
      return;
    }

    const trimmed = nextName.trim();
    if (!trimmed || trimmed === currentLabel) {
      return;
    }

    this.setStatus(`Renaming ${currentLabel}…`);

    try {
      const { file } = await renameSong(this.selectedFileId, trimmed);
      this.selectedFileName = file.name;
      this.updateListedSong(this.selectedFileId, {
        title: this.selectedFileTitle,
        name: file.name,
      });
      this.onSongRenamed({ file });
      this.setStatus('');
    } catch (error) {
      this.handleError(error);
    }
  }

  async deleteSelectedFile() {
    if (!this.canManageFiles || !this.selectedFileId || !this.selectedFileName) {
      return;
    }

    const label = getSongListLabel({
      title: this.selectedFileTitle,
      name: this.selectedFileName,
    });
    const confirmed = window.confirm(
      `Move “${label}” to the Google Drive bin?\n\nYou can restore it from drive.google.com/drive/trash.`,
    );
    if (!confirmed) {
      return;
    }

    const deletedFileId = this.selectedFileId;
    this.setStatus(`Moving ${label} to bin…`);

    try {
      await deleteSong(deletedFileId);
      this.removeListedSong(deletedFileId);
      this.selectedFileId = null;
      this.selectedFileName = null;
      this.selectedFileTitle = null;
      this.updateFileActionButtons();
      this.onSongDeleted(deletedFileId);
      this.setStatus('');
    } catch (error) {
      this.handleError(error);
    }
  }

  async matchFileNameToTitle() {
    const title = this.selectedFileTitle?.trim();
    if (!this.canManageFiles || !this.selectedFileId || !this.selectedFileName || !title) {
      return;
    }

    const extension = getFileExtension(this.selectedFileName);
    const nextName = fileNameFromTitle(title, extension);
    if (!nextName || fileNameMatchesTitle(this.selectedFileName, title)) {
      return;
    }

    const confirmed = window.confirm(
      `Rename file to match title?\n\n“${this.selectedFileName}” → “${nextName}”`,
    );
    if (!confirmed) {
      return;
    }

    this.setStatus(`Renaming to ${nextName}…`);

    try {
      const { file } = await renameSong(this.selectedFileId, nextName);
      this.selectedFileName = file.name;
      this.updateListedSong(this.selectedFileId, {
        title: this.selectedFileTitle,
        name: file.name,
      });
      this.onSongRenamed({ file });
      this.setStatus('');
    } catch (error) {
      this.handleError(error);
    }
  }
}

export default SongBrowser;
