import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@incitio/renderer/styles.css';
import './app.css';
import './boards.css';
// First: every picture from the chain's image service goes through the API's cache.
import './image-route.js';
import { App } from './App.js';
import { SessionGate } from './SignIn.js';

const container = document.getElementById('root');
if (!container) throw new Error('missing #root');
createRoot(container).render(
  <StrictMode>
    <SessionGate>
      <App />
    </SessionGate>
  </StrictMode>,
);
