import React from 'react';
import ReactDOM from 'react-dom/client';
import './i18n';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import './styles/local-fonts.css';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <ErrorBoundary level="root" name="app-root">
            <App />
        </ErrorBoundary>
    </React.StrictMode>
);
