/**
 * Tools de Spotify: buscar, reproducir, crear playlists y leer tus tops.
 *
 * Son tools normales del Strands SDK (`tool()` + Zod). El harness no las cambia:
 * se las pasamos tal cual en `createHarness({ tools })`.
 */

import { tool } from "@strands-agents/sdk";
import { z } from "zod";
import {
  conFiltroDeAnios,
  type SpotifyClient,
  type SpotifyTrack,
  type TimeRange,
} from "../spotify/client.js";
import { reproducirUri, SIN_DISPOSITIVO } from "../spotify/local.js";

// El guion es el operador NOT de Spotify y las comillas rompen los filtros.
const limpiar = (texto: string) =>
  texto.replace(/["']/g, " ").replace(/-/g, " ").replace(/\s+/g, " ").trim();

const periodo = z
  .enum(["short_term", "medium_term", "long_term"])
  .optional()
  .describe('"short_term" (último mes), "medium_term" (6 meses), "long_term" (siempre)');

/** Crea las tools de Spotify sobre un cliente ya autenticado. */
export function spotifyTools(sp: SpotifyClient) {
  const buscarEnSpotify = tool({
    name: "buscar_en_spotify",
    description: `Busca canciones en Spotify. Úsala SIEMPRE que el usuario pregunte por música.
Para tener variedad haz VARIAS búsquedas distintas y combina resultados.
El query acepta filtros: "genre:house", "artist:Disclosure".
Para acotar por época usa anio_inicio/anio_fin (no escribas year: en el query).
Cada búsqueda trae máximo 10 resultados; usa 'offset' (10, 20...) para traer más.`,
    inputSchema: z.object({
      query: z.string().describe("Texto de búsqueda, admite filtros genre:/artist:"),
      limite: z.number().default(10).describe("Máximo de resultados, de 1 a 10"),
      offset: z.number().default(0).describe("Desde qué resultado empezar"),
      anio_inicio: z.number().optional().describe("Año inicial, ej. 2015"),
      anio_fin: z.number().optional().describe("Año final, ej. 2024"),
    }),
    callback: async (input) => {
      // Spotify limita la búsqueda a 10 resultados por llamada (11+ da "Invalid limit").
      const limite = Math.min(Math.max(input.limite ?? 10, 1), 10);
      const query = conFiltroDeAnios(input.query, input.anio_inicio, input.anio_fin);
      try {
        const tracks = await sp.searchTracks(query, limite, Math.max(input.offset ?? 0, 0));
        if (tracks.length === 0) return `No encontré canciones en Spotify para: ${input.query}`;
        return JSON.stringify(
          tracks.map((t) => ({
            titulo: t.name,
            artista: t.artists[0].name,
            album: t.album.name,
            uri: t.uri,
            duracion_min: Math.round((t.duration_ms / 60000) * 10) / 10,
          })),
          null,
          2,
        );
      } catch (e) {
        return `Error al buscar en Spotify: ${e}`;
      }
    },
  });

  const reproducirCancion = tool({
    name: "reproducir_cancion",
    description: `Reproduce una canción en el dispositivo activo de Spotify del usuario.
Úsala SIEMPRE que el usuario pida escuchar, poner o reproducir algo.
Manda el título en 'nombre_cancion' y el artista por separado en 'artista'.`,
    inputSchema: z.object({
      nombre_cancion: z.string().describe("Solo el título, sin el artista"),
      artista: z.string().optional().describe("Artista, por separado. Mejora mucho el acierto"),
    }),
    callback: async (input) => {
      try {
        // De la búsqueda más específica a la más laxa; nos quedamos con el primer acierto.
        const titulo = limpiar(input.nombre_cancion);
        const artista = input.artista ? limpiar(input.artista) : "";
        const intentos = artista
          ? [`${titulo} ${artista}`, `track:"${titulo}" artist:"${artista}"`, titulo]
          : [titulo, `track:"${titulo}"`];

        let tracks: SpotifyTrack[] = [];
        for (const q of intentos) {
          tracks = await sp.searchTracks(q, 5);
          if (tracks.length > 0) break;
        }
        if (tracks.length === 0) return `No encontré "${input.nombre_cancion}" en Spotify.`;

        const track = tracks[0];
        // Reproduce y confirma que de verdad suena (con plan B local en macOS).
        const via = await reproducirUri(sp, track.uri);

        return JSON.stringify({
          status: "reproduciendo",
          cancion: track.name,
          artista: track.artists[0].name,
          album: track.album.name,
          via,
        });
      } catch (e: any) {
        const msg = e?.message ?? String(e);
        if (msg.includes("NO_ACTIVE_DEVICE") || msg.includes("Player command failed")) {
          return SIN_DISPOSITIVO;
        }
        if (msg.includes("PREMIUM_REQUIRED")) {
          return "❌ Se requiere Spotify Premium para controlar la reproducción.";
        }
        return `❌ Error al reproducir: ${msg}`;
      }
    },
  });

  const crearPlaylist = tool({
    name: "crear_playlist_en_spotify",
    description: "Crea una playlist privada en la cuenta de Spotify del usuario con las canciones indicadas.",
    inputSchema: z.object({
      nombre: z.string().describe("Nombre de la playlist"),
      descripcion: z.string().describe("Descripción breve"),
      canciones_uris: z.array(z.string()).describe("URIs de Spotify (spotify:track:...) o nombres de canciones"),
    }),
    callback: async (input) => {
      if (!input.canciones_uris?.length) return "No me diste canciones para la playlist.";

      // Si no es una URI, la buscamos por nombre.
      const uris: string[] = [];
      for (const item of input.canciones_uris.map((s) => s.trim())) {
        if (item.startsWith("spotify:track:")) {
          uris.push(item);
          continue;
        }
        try {
          const [encontrada] = await sp.searchTracks(limpiar(item), 1);
          if (encontrada) uris.push(encontrada.uri);
        } catch {
          /* la saltamos */
        }
      }
      if (uris.length === 0) return "No pude encontrar ninguna de las canciones en Spotify.";

      try {
        const me = await sp.getMe();
        const playlist = await sp.createPlaylist(me.id, input.nombre, input.descripcion, false);
        for (let i = 0; i < uris.length; i += 100) {
          await sp.addTracksToPlaylist(playlist.id, uris.slice(i, i + 100));
        }
        return JSON.stringify({
          status: "ok",
          mensaje: `Playlist '${input.nombre}' creada con ${uris.length} canciones`,
          url: playlist.external_urls.spotify,
        });
      } catch (e) {
        return `Error al crear la playlist: ${e}`;
      }
    },
  });

  const misTopArtistas = tool({
    name: "mis_top_artistas",
    description: "Obtiene los artistas más escuchados del usuario en Spotify.",
    inputSchema: z.object({ periodo }),
    callback: async ({ periodo }) => {
      try {
        const artistas = await sp.getTopArtists(10, (periodo ?? "medium_term") as TimeRange);
        // Feb 2026: Spotify dejó de mandar `genres` en los artistas; lo incluimos solo si viene.
        return JSON.stringify(
          artistas.map((a, i) => ({
            posicion: i + 1,
            nombre: a.name,
            ...(a.genres?.length ? { generos: a.genres.slice(0, 3) } : {}),
          })),
        );
      } catch (e) {
        return `Error: ${e}`;
      }
    },
  });

  const misTopCanciones = tool({
    name: "mis_top_canciones",
    description: "Obtiene las canciones más escuchadas del usuario en Spotify.",
    inputSchema: z.object({ periodo }),
    callback: async ({ periodo }) => {
      try {
        const canciones = await sp.getTopTracks(10, (periodo ?? "medium_term") as TimeRange);
        return JSON.stringify(
          canciones.map((t) => ({ titulo: t.name, artista: t.artists[0].name, uri: t.uri })),
        );
      } catch (e) {
        return `Error: ${e}`;
      }
    },
  });

  return [buscarEnSpotify, reproducirCancion, crearPlaylist, misTopArtistas, misTopCanciones];
}
