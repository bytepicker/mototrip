import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// For a GitHub project page, set VITE_BASE=/repository-name/ in the workflow.
export default defineConfig({ plugins: [react()], base: process.env.VITE_BASE || '/' })
