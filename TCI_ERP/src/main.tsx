import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@fontsource-variable/inter'
import '@fontsource/pt-sans-narrow/400.css'
import '@fontsource/pt-sans-narrow/700.css'
import '@fontsource/arimo/400.css'
import '@fontsource/arimo/700.css'
import { i18nReady } from './i18n'
import './index.css'
import App from './App'
import { AuthProvider } from './auth/AuthContext'

const queryClient = new QueryClient({
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
