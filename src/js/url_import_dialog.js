import Component from './component';
import { importFromUrl } from './song_api_client';

class UrlImportDialog extends Component {
  onImported = () => {};

  setup() {
    this.form = this.element('form');
    this.urlInput = this.element('url');
    this.errorElement = this.element('error');
    this.importButton = this.element('import');
    this.cancelButton = this.element('cancel');

    this.onClick('cancel', () => this.close());
    this.form.addEventListener('cancel', (event) => {
      event.preventDefault();
      this.close();
    });
    this.form.addEventListener('submit', (event) => {
      event.preventDefault();
      this.submit();
    });
  }

  open() {
    this.errorElement.hidden = true;
    this.errorElement.textContent = '';
    this.urlInput.value = '';
    this.container.showModal();
    this.urlInput.focus();
  }

  close() {
    if (this.container.open) {
      this.container.close();
    }
  }

  setBusy(isBusy) {
    this.importButton.disabled = isBusy;
    this.cancelButton.disabled = isBusy;
    this.urlInput.disabled = isBusy;
    this.importButton.textContent = isBusy ? 'Importing…' : 'Import';
  }

  showError(message) {
    this.errorElement.textContent = message;
    this.errorElement.hidden = !message;
  }

  async submit() {
    const url = this.urlInput.value.trim();
    if (!url) {
      this.showError('Enter a URL.');
      return;
    }

    this.setBusy(true);
    this.showError('');

    try {
      const result = await importFromUrl(url);
      this.onImported(result);
      this.close();
    } catch (error) {
      this.showError(error.message || 'Import failed.');
    } finally {
      this.setBusy(false);
    }
  }
}

export default UrlImportDialog;
