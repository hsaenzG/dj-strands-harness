/**
 * GET /api/playlist?id=<playlistId> → nombre, cover, descripción y tracks.
 * Para la tarjeta que aparece en el chat cuando el agente crea una playlist.
 */

import type { APIRoute } from "astro";
import { json, mensajeDeError } from "../../lib/http.js";
import { getPlaylistMetadata } from "../../lib/reproductor.js";

export const GET: APIRoute = async ({ url }) => {
  const id = url.searchParams.get("id")?.trim();
  if (!id || !/^[A-Za-z0-9]+$/.test(id)) return json({ error: "Parámetro 'id' inválido." }, 400);
  try {
    return json((await getPlaylistMetadata(id)) ?? { error: "Spotify no está conectado." });
  } catch (e) {
    return json({ error: mensajeDeError(e) });
  }
};
