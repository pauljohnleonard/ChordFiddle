import Component from './component';

class Toast extends Component {
  timeout = null;

  show(message, type = 'success') {
    this.element('message').textContent = message;
    this.container.className = `Toast Toast--${type} Toast--visible`;

    clearTimeout(this.timeout);
    this.timeout = setTimeout(() => this.hide(), 4000);
  }

  hide() {
    this.container.classList.remove('Toast--visible');
  }
}

export default Toast;
