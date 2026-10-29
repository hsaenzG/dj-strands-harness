/**
 * OAuth de Spotify para el CLI.
 *
 * Si ya hay un token guardado lo usa. Si no, abre el navegador y levanta un mini
 * servidor en el puerto 8000 para recibir el callback de Spotify.
 */

import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { SpotifyClient } from "./client.js";
import { buildAuthorizeUrl, clientFromToken, exchangeCode, loadToken, saveToken } from "./oauth.js";

const REDIRECT_URI = "http://127.0.0.1:8000/callback";

export async function authenticateSpotify(clientId: string, clientSecret: string): Promise<SpotifyClient> {
  const cached = loadToken();
  if (cached) {
    try {
      const client = clientFromToken(clientId, clientSecret, cached);
      // getMe verifica que el token sirva y dispara un refresh si ya expiró.
      const user = await client.getMe();
      console.log(`✅ Conectado a Spotify como: ${user.display_name}`);
      return client;
    } catch {
      console.log("⚠  Token cacheado inválido, re-autenticando...");
    }
  }

  const state = randomUUID();
  const authUrl = buildAuthorizeUrl(clientId, REDIRECT_URI, state);
  console.log("\n🔐 Abriendo navegador para autorizar Spotify...");
  console.log(`   Si no se abre automáticamente, visita:\n   ${authUrl}\n`);
  execFile("open", [authUrl]);

  const code = await waitForCallback(state);
  const token = await exchangeCode(clientId, clientSecret, code, REDIRECT_URI);
  saveToken(token);

  const client = clientFromToken(clientId, clientSecret, token);
  const user = await client.getMe();
  console.log(`✅ Conectado a Spotify como: ${user.display_name}`);
  return client;
}

/** Servidor HTTP temporal en el puerto 8000 que espera el callback de Spotify. */
function waitForCallback(expectedState: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url!, "http://127.0.0.1:8000");
      if (url.pathname !== "/callback") {
        res.writeHead(404).end("Not found");
        return;
      }

      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");
      const ok = code && !error && url.searchParams.get("state") === expectedState;

      res.writeHead(ok ? 200 : 400, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        ok
          ? `<html><body style="background:#0d1117;color:#00ff88;font-family:monospace;text-align:center;padding:4rem;">
               <h1>✅ Spotify autorizado</h1><p>Puedes cerrar esta pestaña y volver a la terminal.</p>
             </body></html>`
          : `<h1>❌ Error: ${error ?? "state inválido"}</h1><p>Cierra esta pestaña.</p>`,
      );
      server.close();
      clearTimeout(timer);
      ok ? resolve(code!) : reject(new Error(`Spotify auth error: ${error ?? "state inválido"}`));
    });

    server.listen(8000, "127.0.0.1", () => {
      console.log("   Esperando autorización en http://127.0.0.1:8000/callback ...");
    });

    const timer = setTimeout(() => {
      server.close();
      reject(new Error("Timeout esperando autorización de Spotify (2 min)"));
    }, 120_000);
  });
}
