import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { AuthProvider } from './auth/AuthContext';
import { useAuth } from './auth/useAuth';
import { ColorModeProvider } from './theme';

/** Theme for the signed-in user's saved light / dark / high-contrast choice. */
function UserColorMode({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  return <ColorModeProvider userId={user?.id}>{children}</ColorModeProvider>;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 15_000 },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <UserColorMode>
            <App />
          </UserColorMode>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
