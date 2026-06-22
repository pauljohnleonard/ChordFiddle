import Component from './component';
import debounce from './debounce';
import {
  checkApiHealth,
  listAllFolderContents,
  loadSong,
  fetchTags,
  searchSongs,
} from './song_api_client';

class SongBrowser extends Component {
  onSongSelected = () => {};

  rootFolderId = 'root';
  allowedExtensions = [];
  currentFolderId = '';
  folderStack = [];
  selectedFileId = null;
  searchQuery = '';
  selectedTag = '';
  searchScope = 'folder';
  availableTags = [];
  filterActive = false;

  setup() {
    this.listElement = this.element('list');
    this.statusElement = this.element('status');
    this.breadcrumbElement = this.element('breadcrumb');
    this.searchInput = this.element('search');
    this.tagsElement = this.element('tags');
    this.scopeElement = this.element('scope');
    this.clearButton = this.element('clearButton');

    this.onClick('backButton', () => this.navigateUp());
    this.onClick('clearButton', () => this.clearFilters());

    this.searchInput.addEventListener('input', debounce(() => {
      this.searchQuery = this.searchInput.value.trim();
      this.refreshList();
    }, 250));

    this.scopeElement.addEventListener('change', () => {
      const selected = this.scopeElement.querySelector('input[name="songBrowserScope"]:checked');
      this.searchScope = selected?.value || 'folder';
      if (this.filterActive) {
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
    await this.loadTags();
    await this.loadCurrentFolder();
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
        this.renderTags();
        this.refreshList();
      });
      this.tagsElement.appendChild(chip);
    });
  }

  isFilterActive() {
    return Boolean(this.searchQuery || this.selectedTag);
  }

  updateFilterUi() {
    this.filterActive = this.isFilterActive();
    this.clearButton.hidden = !this.filterActive;
    this.element('backButton').disabled = this.filterActive || this.folderStack.length === 0;
  }

  clearFilters() {
    this.searchQuery = '';
    this.selectedTag = '';
    this.searchInput.value = '';
    this.renderTags();
    this.refreshList();
  }

  async refreshList() {
    if (this.isFilterActive()) {
      await this.loadSearchResults();
    } else {
      await this.loadCurrentFolder();
    }
  }

  async loadSearchResults() {
    this.setStatus('Searching…');
    this.listElement.innerHTML = '';

    try {
      const results = await searchSongs({
        q: this.searchQuery,
        tag: this.selectedTag,
        folderId: this.currentFolderId,
        scope: this.searchScope,
      });

      this.renderBreadcrumb(true, results.total);
      this.renderSearchResults(results.songs);

      if (results.songs.length === 0) {
        this.setStatus('No songs match your search.');
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
      const { folders, files, skipped } = await listAllFolderContents(this.currentFolderId);
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

  emptyFolderMessage(skipped) {
    if (skipped.length === 0) {
      return 'Drive returned no files here. If your .pro songs are inside a subfolder, open a [dir] folder above.';
    }

    const examples = skipped.slice(0, 3).map((file) => `${file.name} (${file.mimeType})`).join(', ');
    return `No .pro or supported songs found. Drive has ${skipped.length} other item(s): ${examples}${skipped.length > 3 ? '…' : ''}`;
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

  renderSearchResults(songs) {
    songs.forEach((song) => {
      const item = this.createListItem(song.title || song.name, 'file');
      if (song.folderPath) {
        const meta = document.createElement('span');
        meta.className = 'SongBrowser__item-meta';
        meta.textContent = song.folderPath;
        item.appendChild(meta);
      }
      if (song.fileId === this.selectedFileId) {
        item.classList.add('SongBrowser__item--selected');
      }
      item.addEventListener('click', () => this.selectFileById(song.fileId, song.name));
      this.listElement.appendChild(item);
    });
  }

  renderEntries(folders, files) {
    folders.forEach((folder) => {
      const item = this.createListItem(folder.name, 'folder');
      item.addEventListener('click', () => this.navigateInto(folder));
      this.listElement.appendChild(item);
    });

    files.forEach((file) => {
      const item = this.createListItem(file.name, 'file');
      if (file.id === this.selectedFileId) {
        item.classList.add('SongBrowser__item--selected');
      }
      item.addEventListener('click', () => this.selectFile(file));
      this.listElement.appendChild(item);
    });
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
    if (this.filterActive) {
      return;
    }

    this.folderStack.push({ id: this.currentFolderId, name: folder.name });
    this.currentFolderId = folder.id;
    await this.loadCurrentFolder();
  }

  async navigateUp() {
    if (this.filterActive || this.folderStack.length === 0) {
      return;
    }

    const parent = this.folderStack.pop();
    this.currentFolderId = parent.id;
    await this.loadCurrentFolder();
  }

  async selectFile(file) {
    this.selectedFileId = file.id;
    this.setStatus(`Loading ${file.name}…`);

    Array.from(this.listElement.querySelectorAll('.SongBrowser__item--selected')).forEach((item) => {
      item.classList.remove('SongBrowser__item--selected');
    });

    try {
      const { file: metadata, content } = await loadSong(file.id);
      this.onSongSelected({ file: metadata, content });
      this.setStatus('');
      await this.refreshList();
    } catch (error) {
      this.handleError(error);
    }
  }

  async selectFileById(fileId, name = 'song') {
    this.selectedFileId = fileId;
    this.setStatus(`Loading ${name}…`);

    try {
      const { file: metadata, content } = await loadSong(fileId);
      this.onSongSelected({ file: metadata, content });
      this.setStatus('');
    } catch (error) {
      this.handleError(error);
    }
  }

  setStatus(message) {
    this.statusElement.textContent = message;
  }
}

export default SongBrowser;
