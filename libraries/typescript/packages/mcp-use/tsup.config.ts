import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['index.ts', 'src/browser.ts', 'src/react/index.ts', 'src/server/index.ts'],
  format: ['cjs', 'esm'],
  outDir: 'dist',
  keepNames: true,
  dts: false, // We run tsc separately for declarations
  external: [
    // Keep Tailwind CSS and its dependencies external (native modules)
    'tailwindcss',
    '@tailwindcss/vite',
    '@tailwindcss/oxide',
    // Keep Vite React plugin external (optional peer dependency)
    '@vitejs/plugin-react',
  ],
})

