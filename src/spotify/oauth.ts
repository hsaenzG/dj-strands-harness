/**
 * OAuth de Spotify compartido por el CLI y la web (Authorization Code flow).
 *
 * Los dos guardan el token en el mismo archivo (.spotify_token.json en la raíz),
 * así que si autorizas en uno, el otro ya queda conectado.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SpotifyClient } from "./client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const TOKEN_PATH = resolve(__dirname, "../../.spotify_token.json");

const AUTH_URL = "https://accounts.spotify.com/authorize";
const TOKEN_URL = "https://accounts.spotify.com/api/token";

const SCOPES = [
  "playlist-modify-public",
  "playlist-modify-private",
  "user-library-read",
  "user-top-read",
  "user-modify-playback-state",
  "user-read-playback-state",
  "user-read-recently-played",
];

export interface TokenData {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export function loadToken(): TokenData | null {
  if (!existsSync(TOKEN_PATH)) return null;
  try {
    return JSON.parse(readFileSync(TOKEN_PATH, "utf-8")) as TokenData;
  } catch {
    return null;
  }
}

export function saveToken(data: TokenData): void {
  writeFileSync(TOKEN_PATH, JSON.stringify(data, null, 2));
}

/** Cliente de Spotify que guarda en disco cada refresh del token. */
export function clientFromToken(clientId: string, clientSecret: string, token: TokenData): SpotifyClient {
  return new SpotifyClient({
    clientId,
    clientSecret,
    accessToken: token.accessToken,
    refreshToken: token.refreshToken,
    expiresAt: token.expiresAt,
    // El refresh token no cambia al renovar, lo conservamos.
    onTokenRefresh: (accessToken, expiresAt) =>
      saveToken({ accessToken, refreshToken: token.refreshToken, expiresAt }),
  });
}

export function buildAuthorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    scope: SCOPES.join(" "),
    redirect_uri: redirectUri,
    state,
    show_dialog: "true",
  });
  return `${AUTH_URL}?${params.toString()}`;
}

/** Intercambia el authorization code por el par de tokens (access + refresh). */
export async function exchangeCode(
  clientId: string,
  clientSecret: string,
  code: string,
  redirectUri: string,
): Promise<TokenData> {
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),
  });
  if (!res.ok) {
    throw new Error(`Error al intercambiar el code: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}
