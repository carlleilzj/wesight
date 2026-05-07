import './index.css';

import React from 'react';
import ReactDOM from 'react-dom/client';
import { Provider } from 'react-redux';

import App from './App';
import DesktopPetWindow from './components/pet/DesktopPetWindow';
import { store } from './store';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Failed to find the root element');
}

try {
  const windowKind = new URLSearchParams(window.location.search).get('window');
  const content = windowKind === 'desktop-pet'
    ? <DesktopPetWindow />
    : (
      <Provider store={store}>
        <App />
      </Provider>
    );

  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      {content}
    </React.StrictMode>
  );
} catch (error) {
  console.error('Failed to render the app:', error);
}
