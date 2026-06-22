import Component from './component';
import {
  switchToFlat, switchToSharp, transposeDown, transposeUp,
} from './chord_sheet_transformations';

class TransposeToolbar extends Component {
  onTransformClick = () => {};

  setup() {
    this.onClick('transposeDown', () => this.onTransformClick(transposeDown));
    this.onClick('transposeUp', () => this.onTransformClick(transposeUp));
    this.onClick('switchToSharp', () => this.onTransformClick(switchToSharp));
    this.onClick('switchToFlat', () => this.onTransformClick(switchToFlat));
  }
}

export default TransposeToolbar;
