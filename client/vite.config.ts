import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

// Dos páginas: el juego (index.html) y el gestor de assets del backoffice
// (admin-assets.html, servido por el servidor en /admin/assets).
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        assets: fileURLToPath(new URL("./admin-assets.html", import.meta.url)),
      },
    },
  },
});
