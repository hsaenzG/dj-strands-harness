/**
 * GET /api/spotify/callback → recibe el ?code= de Spotify, lo cambia por tokens,
 * los guarda (el mismo archivo que usa el CLI) y rearma el DJ con Spotify.
 */

import type { APIRoute } from "astro";
import { exchangeCode, saveToken } from "../../../../../src/spotify/oauth.js";
import { reconectarSpotify, REDIRECT_URI } from "../../../lib/servidor.js";

export const GET: APIRoute = async ({ url, cookies, redirect }) => {
  const fallo = (reason: string) => redirect(`/?spotify=error&reason=${encodeURIComponent(reason)}`, 302);

  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const state = url.searchParams.get("state");
  const esperado = cookies.get("sp_state")?.value;
  cookies.delete("sp_state", { path: "/" });

  if (error) return fallo(error);
  if (!code) return fallo("missing_code");
  if (!state || state !== esperado) return fallo("state_invalido");

  const { SPOTIFY_CLIENT_ID: id, SPOTIFY_CLIENT_SECRET: secret } = process.env;
  if (!id || !secret) return fallo("missing_credentials");

  try {
    saveToken(await exchangeCode(id, secret, code, REDIRECT_URI));
    await reconectarSpotify();
    return redirect("/?spotify=connected", 302);
  } catch (e) {
    return fallo(e instanceof Error ? e.message : "error_desconocido");
  }
};
