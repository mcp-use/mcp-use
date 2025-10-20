import antfu from '@antfu/eslint-config'

export default antfu({
  formatters: {
    // Disable auto-formatting that interferes with React 19 Provider syntax
    markdown: false,
    css: false,
    html: false,
    graphql: false,
  },
  typescript: true,
  react: true,
  rules: {
    'node/prefer-global/process': 'off',
    // Disable React 19 Context.Provider shorthand auto-fix
    // It incorrectly applies to non-Context components like Radix UI's Provider
    'react-x/no-deprecated-render': 'off',
    '@eslint-react/no-children-prop': 'off',
    'react-dom/no-missing-button-type': 'off',
    'react-refresh/only-export-components': 'off',
    'react-dom/no-context-provider': 'off',
    'react/no-context-provider': 'off',
    'style/jsx-self-closing-comp': 'off',
    'style/jsx-wrap-multilines': 'off',
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
