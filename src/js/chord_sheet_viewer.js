import chordsheetjs from 'chordsheetjs';
import Component from './component';

const formatters = {
  html: chordsheetjs.HtmlDivFormatter,
  text: chordsheetjs.TextFormatter,
};

class ChordSheetViewer extends Component {
  onDisplayModeChanged = () => {};

  onFullscreenClick = () => {};

  setup() {
    this.onChange('displayModeHtml', () => this.displayModeChanged());
    this.onChange('displayModeText', () => this.displayModeChanged());
    this.onClick('fullscreen', () => {
      if (!this.element('fullscreen')?.disabled) {
        this.onFullscreenClick();
      }
    });
  }

  displayModeChanged() {
    const displayMode = this.getSelectedMode();
    this.onDisplayModeChanged(displayMode);
  }

  render(song, config) {
    const displayMode = this.getSelectedMode();
    const outlet = this.element('outlet');
    outlet.dataset.mode = displayMode;

    const formatter = new formatters[displayMode](config);
    const formattedSheet = formatter.format(song);

    switch (displayMode) {
      case 'text':
        outlet.innerText = formattedSheet;
        break;
      default:
        outlet.innerHTML = formattedSheet;
    }
  }

  getDisplayModeRadios() {
    return Array.from(this.container.querySelectorAll('input[name="display_mode"]'));
  }

  getSelectedMode() {
    return this
      .getDisplayModeRadios()
      .find((input) => input.checked)
      .value;
  }

  setSelectedMode(mode) {
    this
      .getDisplayModeRadios()
      .find((input) => input.value === mode)
      .checked = true;
  }
}

export default ChordSheetViewer;
