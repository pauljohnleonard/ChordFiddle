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

function isIos() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function preferCssFullscreen() {
  return isIos() || !document.documentElement.requestFullscreen;
}

const COLUMNS_STORAGE_KEY = 'cheesejam.view.columns';

function readColumnsPreference() {
  try {
    return localStorage.getItem(COLUMNS_STORAGE_KEY) === '2' ? 2 : 1;
  } catch {
    return 1;
  }
}

function writeColumnsPreference(columns) {
  try {
    localStorage.setItem(COLUMNS_STORAGE_KEY, String(columns));
  } catch {
    // ignore quota / private mode
  }
}

class FullscreenViewer extends Component {
  onClose = () => {};

  isOpen = false;

  usesNativeFullscreen = false;

  viewportListeners = null;

  columns = readColumnsPreference();

  setup() {
    this.outlet = this.element('outlet');
    this.closeButton = this.element('close');
    this.columnsButton = this.element('columns');
    this.applyColumns(this.columns);
    this.onClick('columns', () => this.toggleColumns());
    this.onClick('close', () => this.close());
    this.onResize = () => {
      if (this.isOpen) {
        this.syncColumnLayout();
      }
    };
    window.addEventListener('resize', this.onResize);
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

    // Native FS can drop on iOS scroll — fall back to CSS overlay instead of closing.
    if (this.usesNativeFullscreen) {
      this.usesNativeFullscreen = false;
      this.enterCssFullscreen();
      return;
    }

    this.dismiss();
  }

  bindViewportListeners() {
    if (!window.visualViewport || this.viewportListeners) {
      return;
    }

    const update = () => this.syncViewportSize();
    this.viewportListeners = { update };
    window.visualViewport.addEventListener('resize', update);
    window.visualViewport.addEventListener('scroll', update);
  }

  unbindViewportListeners() {
    if (!this.viewportListeners || !window.visualViewport) {
      this.viewportListeners = null;
      return;
    }

    const { update } = this.viewportListeners;
    window.visualViewport.removeEventListener('resize', update);
    window.visualViewport.removeEventListener('scroll', update);
    this.viewportListeners = null;
  }

  syncViewportSize() {
    if (!this.isOpen || !window.visualViewport) {
      return;
    }

    const { height, offsetTop } = window.visualViewport;
    this.container.style.height = `${height}px`;
    this.container.style.top = `${offsetTop}px`;
    this.syncColumnLayout();
  }

  enterCssFullscreen() {
    document.documentElement.classList.add('FullscreenViewer--active');
    document.body.classList.add('FullscreenViewer--bodyLock');
    this.scrollLockY = window.scrollY;

    if (isIos()) {
      this.bindViewportListeners();
      this.syncViewportSize();
      // Brief scroll nudge can shrink Safari's bottom toolbar on iPad.
      requestAnimationFrame(() => {
        window.scrollTo(0, this.scrollLockY + 1);
        requestAnimationFrame(() => window.scrollTo(0, this.scrollLockY));
      });
    }

    requestAnimationFrame(() => this.syncColumnLayout());
  }

  exitCssFullscreen() {
    document.documentElement.classList.remove('FullscreenViewer--active');
    document.body.classList.remove('FullscreenViewer--bodyLock');
    this.container.style.height = '';
    this.container.style.top = '';
    this.unbindViewportListeners();

    if (this.scrollLockY != null) {
      window.scrollTo(0, this.scrollLockY);
      this.scrollLockY = null;
    }
  }

  async open({ title, content, mode }) {
    this.isOpen = true;
    this.usesNativeFullscreen = false;
    const label = title ? `Close view: ${title}` : 'Close view';
    this.closeButton.setAttribute('aria-label', label);
    this.closeButton.title = 'Close view (Esc)';
    this.setContent(content, mode);
    this.container.hidden = false;

    if (preferCssFullscreen()) {
      this.enterCssFullscreen();
      return;
    }

    try {
      await requestElementFullscreen(this.container);
      this.usesNativeFullscreen = true;
      requestAnimationFrame(() => this.syncColumnLayout());
    } catch {
      this.enterCssFullscreen();
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
      this.outlet.textContent = content;
    } else {
      this.outlet.innerHTML = content;
    }
    this.applyColumns(this.columns);
    this.updateColumnsButton();
    requestAnimationFrame(() => this.syncColumnLayout());
  }

  syncColumnLayout() {
    if (Number(this.outlet.dataset.columns) !== 2 || this.outlet.dataset.mode !== 'html') {
      this.outlet.style.removeProperty('--fullscreen-column-height');
      return;
    }

    const outletStyle = getComputedStyle(this.outlet);
    const paddingBottom = parseFloat(outletStyle.paddingBottom) || 0;
    const chordSheet = this.outlet.querySelector('.chord-sheet');
    const headerBottom = chordSheet
      ? chordSheet.offsetTop
      : parseFloat(outletStyle.paddingTop) || 0;
    const available = this.outlet.clientHeight - headerBottom - paddingBottom;

    this.outlet.style.setProperty(
      '--fullscreen-column-height',
      `${Math.max(120, Math.floor(available))}px`,
    );
  }

  applyColumns(columns) {
    this.columns = columns === 2 ? 2 : 1;
    this.outlet.dataset.columns = String(this.columns);
    writeColumnsPreference(this.columns);
    this.updateColumnsButton();
    this.syncColumnLayout();
  }

  toggleColumns() {
    this.applyColumns(this.columns === 2 ? 1 : 2);
  }

  updateColumnsButton() {
    if (!this.columnsButton) {
      return;
    }

    const isHtml = this.outlet.dataset.mode === 'html';
    this.columnsButton.hidden = !isHtml;

    if (!isHtml) {
      return;
    }

    const twoColumns = this.columns === 2;
    this.columnsButton.textContent = twoColumns ? '1 col' : '2 col';
    this.columnsButton.setAttribute(
      'aria-label',
      twoColumns ? 'Switch to one column' : 'Switch to two columns',
    );
    this.columnsButton.title = twoColumns ? 'One column' : 'Two columns';
    this.columnsButton.setAttribute('aria-pressed', twoColumns ? 'true' : 'false');
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
    this.exitCssFullscreen();
    this.onClose();
  }
}

export default FullscreenViewer;
