import Component from './component';
import {
  switchToFlat, switchToSharp, transposeDown, transposeUp,
} from './chord_sheet_transformations';

class SongEditorToolbar extends Component {
  onTransformClick = () => {};

  onSaveClick = () => {};

  setup() {
    this.saveButton = this.element('saveSong');
    this.onClick('transposeDown', () => this.onTransformClick(transposeDown));
    this.onClick('transposeUp', () => this.onTransformClick(transposeUp));
    this.onClick('switchToSharp', () => this.onTransformClick(switchToSharp));
    this.onClick('switchToFlat', () => this.onTransformClick(switchToFlat));
    this.onClick('saveSong', () => {
      if (!this.saveButton?.disabled) {
        this.onSaveClick();
      }
    });
    this.setSaveEnabled(false, 'Open a song from the library');
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
