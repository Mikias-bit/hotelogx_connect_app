import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import viteTsConfigPaths from 'vite-tsconfig-paths'
import tailwindcss from '@tailwindcss/vite'
import netlify from '@netlify/vite-plugin-tanstack-start'

export default defineConfig(({ command }) => ({
  plugins: [
    viteTsConfigPaths({
      projects: ['./tsconfig.json'],
    }),
    tailwindcss(),
    command === 'build' ? netlify() : null,
    tanstackStart({
      spa: {
        enabled: true,
        prerender: {
          outputPath: '/index.html',
        },
      },
    }),
    viteReact(),
  ].filter(Boolean),
}))

