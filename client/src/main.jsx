import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App as AntApp } from 'antd';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import { StoreProvider } from './context/StoreContext';
import { CartProvider } from './context/CartContext';
import { ThemeProvider } from './context/ThemeContext';
import { BrandProvider } from './context/BrandContext';
import './index.css';
import './components/ui.css';
import './components/table.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider>
      <BrandProvider>
        <AntApp>
          <BrowserRouter>
            <AuthProvider>
              <StoreProvider>
                <CartProvider>
                  <App />
                </CartProvider>
              </StoreProvider>
            </AuthProvider>
          </BrowserRouter>
        </AntApp>
      </BrandProvider>
    </ThemeProvider>
  </React.StrictMode>
);
