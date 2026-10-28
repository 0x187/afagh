import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';

import { App } from './App';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {/* basename پویا: پوستهٔ پنل زیر /app و صفحات عمومی در ریشه — هر دو یک SPA */}
      <BrowserRouter basename={window.location.pathname === '/app' || window.location.pathname.startsWith('/app/') ? '/app' : '/'}>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
