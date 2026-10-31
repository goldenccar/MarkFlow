import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './app.css'
import './completion.css'
import './editor-preview.css'
import './block-editor.css'
import 'katex/dist/katex.min.css'

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
