
import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles/tailwind.css';
import './styles/theme.css';
import './styles/skin.css';
import App from './App';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error("Could not find root element");

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
