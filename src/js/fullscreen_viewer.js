import Component from './component';

function getFullscreenElement() {
  return document.fullscreenElement
    || document.webkitFullscreenElement
    || null;
}

function requestElementFullscreen(element) {
  const request = element.requestFullscreen || element.webkitRequestFullscreen;
  if (!request) {
    return Promise.reject(new Error('Fullscreen is not supported in this browser.'));
  }
  return Promise.resolve(request.call(element));
}

function exitDocumentFullscreen() {
  const exit = document.exitFullscreen || document.webkitExitFullscreen;
  if (!exit || !getFullscreenElement()) {
    return Promise.resolve();
  }
  return Promise.resolve(exit.call(document));
}

class FullscreenViewer extends Component {
  onClose = () => {};

  isOpen = false;

  usesNativeFullscreen = false;

  setup() {
    this.outlet = this.element('outlet');
    this.closeButton = this.element('close');
    this.onClick('close', () => this.close());
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.isOpen && !getFullscreenElement()) {
        this.close();
      }
    });
    document.addEventListener('fullscreenchange', () => this.handleFullscreenChange());
    document.addEventListener('webkitfullscreenchange', () => this.handleFullscreenChange());
  }

  handleFullscreenChange() {
    if (!this.isOpen || getFullscreenElement() === this.container) {
      return;
    }

    this.dismiss();
  }

  async open({ title, content, mode }) {
    this.isOpen = true;
    this.usesNativeFullscreen = false;
    const label = title ? `Exit fullscreen: ${title}` : 'Exit fullscreen';
    this.closeButton.setAttribute('aria-label', label);
    this.closeButton.title = 'Exit fullscreen (Esc)';
    this.setContent(content, mode);
    this.container.hidden = false;

    try {
      await requestElementFullscreen(this.container);
      this.usesNativeFullscreen = true;
    } catch {
      document.body.classList.add('FullscreenViewer--bodyLock');
    }
  }

  update({ content, mode }) {
    if (!this.isOpen) {
      return;
    }
    this.setContent(content, mode);
  }

  setContent(content, mode) {
    this.outlet.dataset.mode = mode;
    if (mode === 'text') {
      this.outlet.innerText = content;
    } else {
      this.outlet.innerHTML = content;
    }
  }

  close() {
    if (!this.isOpen) {
      return;
    }

    if (getFullscreenElement() === this.container) {
      exitDocumentFullscreen()
        .catch(() => {})
        .finally(() => this.dismiss());
      return;
    }

    this.dismiss();
  }

  dismiss() {
    if (!this.isOpen) {
      return;
    }

    this.isOpen = false;
    this.usesNativeFullscreen = false;
    this.container.hidden = true;
    document.body.classList.remove('FullscreenViewer--bodyLock');
    this.onClose();
  }
}

export default FullscreenViewer;
