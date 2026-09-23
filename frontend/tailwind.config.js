/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      screens: {
        // Tablet tills must get the desktop (side-by-side) POS layout. Samsung
        // Internet / Chrome "desktop site" mode ignore the 1280px viewport in
        // index.html and lay pages out 980px wide, just under the default 1024.
        lg: '960px',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}

