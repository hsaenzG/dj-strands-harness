/**
 * Reproductor y playlists para los endpoints /api (no pasan por el agente).
 */

import type { PlaybackState, SpotifyClient, SpotifyImage } from "../../../src/spotify/client.js";
import { reproducirUri, SIN_DISPOSITIVO } from "../../../src/spotify/local.js";
import { getSpotify } from "./servidor.js";

/** Cover de tamaño medio (Spotify devuelve las imágenes de mayor a menor). */
function pickCover(images?: SpotifyImage[]): string | null {
  return images?.[1]?.url ?? images?.[0]?.url ?? null;
}

export interface NowPlaying {
  isPlaying: boolean;
  progressMs: number;
  durationMs: number;
  title: string;
  artist: string;
  album: string;
  cover: string | null;
  uri: string | null;
  deviceName: string | null;
  volumePercent: number | null;
}

/** Estado normalizado para el visor "now playing". null = nada sonando. */
export async function getNowPlaying(): Promise<NowPlaying | null> {
  const sp = await getSpotify();
  if (!sp) return null;
  const state: PlaybackState | null = await sp.getPlaybackState();
  if (!state?.item) return null;
  return {
    isPlaying: state.is_playing,
    progressMs: state.progress_ms ?? 0,
    durationMs: state.item.duration_ms ?? 0,
    title: state.item.name,
    artist: state.item.artists.map((a) => a.name).join(", "),
    album: state.item.album.name,
    cover: pickCover(state.item.album.images),
    uri: state.item.uri,
    deviceName: state.device?.name ?? null,
    volumePercent: state.device?.volume_percent ?? null,
  };
}

export type PlaybackAction = "play" | "pause" | "next" | "previous" | "seek" | "volume" | "playTrack";
export const ACCIONES: PlaybackAction[] = ["play", "pause", "next", "previous", "seek", "volume", "playTrack"];

/** Con device_id explícito funciona aunque el dispositivo esté disponible pero no "activo". */
async function resolveDeviceId(sp: SpotifyClient): Promise<string> {
  const devices = await sp.getDevices();
  const id = devices.find((d) => d.is_active)?.id ?? devices[0]?.id;
  if (!id) throw new Error(SIN_DISPOSITIVO);
  return id;
}

export async function controlPlayback(
  action: PlaybackAction,
  opts: { positionMs?: number; volumePercent?: number; uri?: string } = {},
): Promise<void> {
  const sp = await getSpotify();
  if (!sp) throw new Error("Spotify no está conectado.");

  if (action === "playTrack") {
    if (!opts.uri) throw new Error("Falta el uri del track a reproducir.");
    await reproducirUri(sp, opts.uri); // con verificación y plan B local en macOS
    return;
  }

  const deviceId = await resolveDeviceId(sp);
  switch (action) {
    case "play":
      return sp.resume(deviceId);
    case "pause":
      return sp.pause(deviceId);
    case "next":
      return sp.next(deviceId);
    case "previous":
      return sp.previous(deviceId);
    case "seek":
      return sp.seek(opts.positionMs ?? 0, deviceId);
    case "volume":
      return sp.setVolume(opts.volumePercent ?? 50, deviceId);
  }
}

export interface PlaylistCard {
  name: string;
  description: string;
  cover: string | null;
  url: string;
  total: number;
  tracks: { title: string; artist: string; cover: string | null; uri: string; durationMs: number }[];
}

/** Metadata de una playlist para la tarjeta que aparece cuando el agente crea una. */
export async function getPlaylistMetadata(playlistId: string): Promise<PlaylistCard | null> {
  const sp = await getSpotify();
  if (!sp) return null;
  const pl = await sp.getPlaylist(playlistId);

  // Feb 2026: Spotify renombró tracks → items (y track → item). Aceptamos ambos formatos.
  const pagina = pl.items ?? pl.tracks;
  const tracks = (pagina?.items ?? [])
    .map((it) => ("item" in it ? it.item : undefined) ?? it.track)
    .filter((t): t is NonNullable<typeof t> => Boolean(t?.uri?.startsWith("spotify:track:")))
    .map((t) => ({
      title: t.name,
      artist: t.artists.map((a) => a.name).join(", "),
      cover: pickCover(t.album.images),
      uri: t.uri,
      durationMs: t.duration_ms,
    }));

  return {
    name: pl.name,
    description: pl.description,
    cover: pickCover(pl.images),
    url: pl.external_urls?.spotify ?? `https://open.spotify.com/playlist/${playlistId}`,
    total: pagina?.total ?? tracks.length,
    tracks,
  };
}
