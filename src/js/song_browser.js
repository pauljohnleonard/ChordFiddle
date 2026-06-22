import Component from './component';
import {
  checkApiHealth,
  listAllFolderContents,
  loadSong,
} from './song_api_client';

class SongBrowser extends Component {
  onSongSelected = () => {};

  rootFolderId = 'root';
  allowedExtensions = [];
  currentFolderId = '';
  folderStack = [];
  selectedFileId = null;

  setup() {
    this.listElement = this.element('list');
    this.statusElement = this.element('status');
    this.breadcrumbElement = this.element('breadcrumb');
    this.onClick('backButton', () => this.navigateUp());
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
    await this.loadCurrentFolder();
  }

  async loadCurrentFolder() {
    this.setStatus('Loading songs…');
    this.listElement.innerHTML = '';

    try {
      const { folders, files, skipped } = await listAllFolderContents(this.currentFolderId);
      this.renderBreadcrumb();
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

  renderBreadcrumb() {
    const parts = ['Songs', ...this.folderStack.map((folder) => folder.name)];
    this.breadcrumbElement.textContent = parts.join(' / ');
    this.element('backButton').disabled = this.folderStack.length === 0;
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
    item.textContent = name;
    return item;
  }

  async navigateInto(folder) {
    this.folderStack.push({ id: this.currentFolderId, name: folder.name });
    this.currentFolderId = folder.id;
    await this.loadCurrentFolder();
  }

  async navigateUp() {
    if (this.folderStack.length === 0) {
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
      await this.loadCurrentFolder();
    } catch (error) {
      this.handleError(error);
    }
  }

  async selectFileById(fileId) {
    this.selectedFileId = fileId;
    this.setStatus('Loading song…');

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
