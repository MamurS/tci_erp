import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@fontsource-variable/inter'
import '@fontsource/pt-sans-narrow/400.css'
import '@fontsource/pt-sans-narrow/700.css'
import '@fontsource/arimo/400.css'
import '@fontsource/arimo/700.css'
import { i18nReady } from './i18n'
import './index.css'
import App from './App'
import { AuthProvider } from './auth/AuthContext'

const mutationCache = new MutationCache()
// Dev only: `[mutation] <key> <ms>` per write (lib/mutationTiming.ts). The
// branch is a constant false in a production build, so the module is not
// even emitted.
if (import.meta.env.DEV) void import('./lib/mutationTiming').then((m) => m.attachMutationTiming(mutationCache))

const queryClient = new QueryClient({
  mutationCache,
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

// First paint waits for the language bundle (instant for the bundled ru).
void i18nReady.finally(() => {
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
})
