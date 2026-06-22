import Component from './component';
import {
  initGoogleAuth,
  isOAuthConfigured,
  isSignedIn,
  onAuthChange,
  signIn,
  signOut,
} from './google_auth';

class GoogleAuthBar extends Component {
  onAuthChange = () => {};

  setup() {
    this.userLabel = this.element('userLabel');
    this.signInButton = this.element('signIn');
    this.signOutButton = this.element('signOut');

    this.onClick('signIn', () => signIn());
    this.onClick('signOut', () => signOut());

    if (!isOAuthConfigured()) {
      this.userLabel.textContent = 'Add GOOGLE_OAUTH_CLIENT_ID to enable saving';
      this.signInButton.disabled = true;
      return;
    }

    initGoogleAuth().then(() => {
      onAuthChange((state) => {
        this.renderState(state);
        this.onAuthChange(state);
      });
    });
  }

  renderState({ isSignedIn: signedIn, user }) {
    if (signedIn) {
      this.userLabel.textContent = user?.email
        ? `Signed in as ${user.email}`
        : 'Signed in with Google';
      this.signInButton.hidden = true;
      this.signOutButton.hidden = false;
      return;
    }

    this.userLabel.textContent = 'Sign in to save edits (Drive Editor role required)';
    this.signInButton.hidden = false;
    this.signOutButton.hidden = true;
  }

  isSignedIn() {
    return isSignedIn();
  }
}

export default GoogleAuthBar;
