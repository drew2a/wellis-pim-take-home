// Tailwind v4 is a PostCSS plugin; Next picks this file up on its own. The whole configuration is
// the `@theme` block in `src/app/globals.css` — v4 has no JavaScript config file.
const config = {
  plugins: { '@tailwindcss/postcss': {} },
};

export default config;
