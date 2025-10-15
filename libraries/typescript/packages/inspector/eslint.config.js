import antfu from '@antfu/eslint-config'

export default antfu({
  formatters: true,
  typescript: true,
  react: true,
  rules: {
    'node/prefer-global/process': 'off',
  },
}, {
  languageOptions: {
    globals: {
      HTMLInputElement: 'readonly',
      HTMLButtonElement: 'readonly',
      HTMLDivElement: 'readonly',
      HTMLSpanElement: 'readonly',
      HTMLElement: 'readonly',
      MutationObserver: 'readonly',
      ResizeObserver: 'readonly',
      queueMicrotask: 'readonly',
    },
  },
})
