/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    '../prompt-lab-extension/src/**/*.{js,jsx}',
    '!../prompt-lab-extension/src/**/* 2.{js,jsx}',
    '!../prompt-lab-extension/src/**/__tests__/**/*.{js,jsx}',
    '!../prompt-lab-extension/src/tests/**/*.{js,jsx}',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};
