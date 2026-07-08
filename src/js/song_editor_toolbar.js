import Component from './component';
import {
  switchToFlat, switchToSharp, transposeDown, transposeUp,
} from './chord_sheet_transformations';

class SongEditorToolbar extends Component {
  onTransformClick = () => {};

  onNewClick = () => {};

  onViewClick = () => {};

  onSaveClick = () => {};

  onImportClick = () => {};

  setup() {
    this.newButton = this.element('newSong');
    this.saveButton = this.element('saveSong');
    this.viewButton = this.element('viewSong');
    this.importButton = this.element('importUrl');
    this.onClick('newSong', () => this.onNewClick());
    this.onClick('transposeDown', () => this.onTransformClick(transposeDown));
    this.onClick('transposeUp', () => this.onTransformClick(transposeUp));
    this.onClick('switchToSharp', () => this.onTransformClick(switchToSharp));
    this.onClick('switchToFlat', () => this.onTransformClick(switchToFlat));
    this.onClick('viewSong', () => {
      if (!this.viewButton?.disabled) {
        this.onViewClick();
      }
    });
    this.onClick('importUrl', () => this.onImportClick());
    this.onClick('saveSong', () => {
      if (!this.saveButton?.disabled) {
        this.onSaveClick();
      }
    });
    this.setSaveEnabled(false, 'Open a song from the library');
    this.setViewEnabled(false, 'Open a song from the library');
  }

  setViewEnabled(enabled, reason = '') {
    if (!this.viewButton) {
      return;
    }

    this.viewButton.disabled = !enabled;
    this.viewButton.setAttribute('aria-disabled', String(!enabled));
    this.viewButton.title = reason;
    this.viewButton.classList.toggle('Toolbar__view--inactive', !enabled);
  }

  setSaveEnabled(enabled, reason = '') {
    if (!this.saveButton) {
      return;
    }

    this.saveButton.disabled = !enabled;
    this.saveButton.setAttribute('aria-disabled', String(!enabled));
    this.saveButton.title = reason;
    this.saveButton.classList.toggle('Toolbar__save--inactive', !enabled);
  }

  setSaveStatus(message) {
    if (this.saveButton) {
      this.saveButton.textContent = message;
    }
  }

  resetSaveLabel(label) {
    this.setSaveStatus(label);
  }
}

export default SongEditorToolbar;
