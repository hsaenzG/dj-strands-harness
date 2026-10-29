/**
 * Reproductor de Spotify.
 *   GET  /api/playback            → estado actual (visor "now playing")
 *   POST /api/playback { action } → play | pause | next | previous | seek | volume | playTrack
 *
 * Requiere Spotify Premium y Spotify abierto en algún dispositivo.
 */

import type { APIRoute } from "astro";
import { json, mensajeDeError } from "../../lib/http.js";
import { ACCIONES, controlPlayback, getNowPlaying, type PlaybackAction } from "../../lib/reproductor.js";

export const GET: APIRoute = async () => {
  try {
    const now = await getNowPlaying();
    return json(now ? { active: true, ...now } : { active: false });
  } catch (e) {
    return json({ active: false, error: mensajeDeError(e) });
  }
};

export const POST: APIRoute = async ({ request }) => {
  const body = await request.json().catch(() => ({}));
  const action = body.action as PlaybackAction;
  if (!ACCIONES.includes(action)) return json({ error: `Acción inválida: ${action}` }, 400);

  try {
    await controlPlayback(action, {
      positionMs: typeof body.positionMs === "number" ? body.positionMs : undefined,
      volumePercent: typeof body.volumePercent === "number" ? body.volumePercent : undefined,
      uri: typeof body.uri === "string" ? body.uri : undefined,
    });
    return json({ ok: true });
  } catch (e) {
    const msg = mensajeDeError(e);
    // "Restriction violated" = el comando no aplica (p. ej. pausar algo ya pausado). Inofensivo.
    if (/Restriction violated/i.test(msg)) return json({ ok: true, noop: true });
    if (/NO_ACTIVE_DEVICE|No active device|404/.test(msg)) {
      return json({ error: "No hay un dispositivo de Spotify activo. Abre Spotify y dale play una vez." });
    }
    if (/PREMIUM_REQUIRED|403/i.test(msg)) {
      return json({ error: "Se requiere Spotify Premium para controlar la reproducción." });
    }
    return json({ error: msg });
  }
};
