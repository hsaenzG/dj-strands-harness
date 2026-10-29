import { defineConfig } from "astro/config";
import node from "@astrojs/node";

export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  // Spotify exige 127.0.0.1 (no "localhost") en el Redirect URI.
  server: { host: "127.0.0.1", port: 4321 },
  // No recargar la página cuando el harness escribe sesiones o memoria.
  vite: { server: { watch: { ignored: ["**/.agent/**", "**/.spotify_token.json"] } } },
});
