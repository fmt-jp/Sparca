import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import './ui/app.css';
import { preloadLazyModules } from './lazy';
import { imageCache } from './render/imageCache';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

preloadLazyModules(() => imageCache.warmUp());
