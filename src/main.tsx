
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'

// In development mode, set up the dark mode by default
if (import.meta.env.DEV) {
  document.documentElement.classList.add('dark');
}

createRoot(document.getElementById("root")!).render(<App />);
