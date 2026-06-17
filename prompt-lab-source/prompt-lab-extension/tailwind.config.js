/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './panel.html',
    './src/**/*.{js,jsx}',
    '!./src/**/* 2.{js,jsx}',
    '!./src/**/__tests__/**/*.{js,jsx}',
    '!./src/tests/**/*.{js,jsx}',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};
