/**
 * GET /api/spotify/login → manda al usuario a autorizar en Spotify.
 * El `state` va en una cookie para validarlo en el callback (anti-CSRF).
 */

import type { APIRoute } from "astro";
import { randomUUID } from "node:crypto";
import { buildAuthorizeUrl } from "../../../../../src/spotify/oauth.js";
import { REDIRECT_URI } from "../../../lib/servidor.js";

export const GET: APIRoute = async ({ cookies, redirect }) => {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  if (!clientId) return new Response("Falta SPOTIFY_CLIENT_ID en el .env", { status: 500 });

  const state = randomUUID();
  cookies.set("sp_state", state, { path: "/", httpOnly: true, sameSite: "lax", maxAge: 600 });
  return redirect(buildAuthorizeUrl(clientId, REDIRECT_URI, state), 302);
};
