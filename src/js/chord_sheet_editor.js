import { createEditor } from '@chordbook/editor';
import { EditorSelection } from '@codemirror/state';
import { linter, setDiagnostics } from '@codemirror/lint';

class ChordSheetEditor {
  onChordSheetChange = () => {};

  constructor(containerID) {
    this.containerID = containerID;
    this.container = document.getElementById(containerID);

    if (!this.container) {
      throw new Error(`Could not find ChordSheetEditor container with ID: ${containerID}`);
    }

    this.editor = null;
    this.initialDoc = this.container.querySelector('script')?.textContent || '';
  }

  element(elementID) {
    return document.getElementById(`${this.containerID}__${elementID}`);
  }

  init() {
    if (this.editor) {
      return;
    }

    this.editor = createEditor({
      doc: this.initialDoc,
      parent: this.container,
      extensions: [
        linter(),
      ],
    });

    this.editor.dom.classList.add('ChordSheetEditor__editor');
    this.editor.dom.addEventListener('change', ({ detail }) => {
      const doc = detail?.doc;
      this.onChordSheetChange(typeof doc === 'string' ? doc : doc?.toString() || this.getValue());
    });
  }

  getSelectionRange() {
    this.init();
    const { from, to } = this.editor.state.selection.main;
    return [from, to];
  }

  setSelectionRange(selectionStart, selectionEnd) {
    this.init();
    this.editor.dispatch({
      selection: EditorSelection.create([
        EditorSelection.range(selectionStart, selectionEnd),
        EditorSelection.cursor(selectionEnd),
      ]),
    });
  }

  focus() {
    this.init();
    this.editor.focus();
  }

  getValue() {
    if (!this.editor) {
      return this.initialDoc;
    }
    return this.editor.state.doc.toString();
  }

  setValue(value) {
    this.initialDoc = value;
    if (!this.editor) {
      return;
    }
    this.editor.dispatch({ changes: { from: 0, to: this.editor.state.doc.length, insert: value } });
    this.onChordSheetChange(value);
  }

  setError(error) {
    const errorElement = this.element('errorMessage');
    if (errorElement) {
      errorElement.innerText = error;
    }
  }

  showError(message, location) {
    this.init();
    this.editor.dispatch(setDiagnostics(this.editor.state, [{
      from: location.start.offset,
      to: location.end.offset,
      severity: 'error',
      message,
    }]));
  }

  resetError() {
    if (!this.editor) {
      return;
    }
    this.editor.dispatch(setDiagnostics(this.editor.state, []));
  }

  transformChordSheet(transformationFunc) {
    const [selectionStart, selectionEnd] = this.getSelectionRange();
    const originalChordSheet = this.getValue();

    if (selectionStart === selectionEnd) {
      const newChordSheet = transformationFunc(originalChordSheet);
      const newCursorPosition = this.calculateNewCursorPosition(originalChordSheet, newChordSheet, selectionStart);
      this.setValue(newChordSheet);
      this.focus();
      this.setSelectionRange(newCursorPosition, newCursorPosition);
    } else {
      const selection = originalChordSheet.slice(selectionStart, selectionEnd);
      const prefix = originalChordSheet.slice(0, selectionStart);
      const suffix = originalChordSheet.slice(selectionEnd);
      const replacement = transformationFunc(selection);
      this.setValue([prefix, replacement, suffix].join(''));
      this.focus();
      this.setSelectionRange(selectionStart, selectionStart + replacement.length);
    }
  }

  calculateNewCursorPosition(originalChordSheet, newChordSheet, cursorPosition) {
    if (cursorPosition === 0) {
      return 0;
    }

    if (cursorPosition === originalChordSheet.length - 1) {
      return newChordSheet.length;
    }

    return cursorPosition;
  }
}

export default ChordSheetEditor;
