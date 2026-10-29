/**
 * Cliente nativo de Spotify — llamadas directas a la Web API con fetch.
 *
 * Es la misma pieza que usa el CLI (typescript/src/spotify_client.ts). Node 18+
 * ya trae fetch, Buffer y URLSearchParams nativos, así que no necesitamos
 * spotify-web-api-node para hablar con Spotify.
 *
 * Diferencia con la versión del CLI: aquí el refresh() también soporta el grant
 * client_credentials (cuando no hay refresh token), para que el fallback de
 * solo-búsqueda del web funcione y se renueve solo.
 *
 * Docs: https://developer.spotify.com/documentation/web-api
 */

const TOKEN_URL = "https://accounts.spotify.com/api/token";
const API_BASE = "https://api.spotify.com/v1";

export interface SpotifyImage {
  url: string;
  width: number | null;
  height: number | null;
}

export interface SpotifyTrack {
  name: string;
  uri: string;
  duration_ms: number;
  artists: { name: string }[];
  album: { name: string; images?: SpotifyImage[] };
}

export interface PlaybackState {
  is_playing: boolean;
  progress_ms: number;
  device: { id: string | null; name: string; volume_percent: number } | null;
  item: SpotifyTrack | null;
}

export interface PlaylistFull {
  name: string;
  description: string;
  external_urls: { spotify: string };
  images: SpotifyImage[];
  /** Feb 2026: antes `tracks.items[].track`, ahora `items.items[].item`. Aceptamos ambos. */
  items?: {
    total: number;
    items: { item?: SpotifyTrack | null; track?: SpotifyTrack | null }[];
  };
  tracks?: {
    total: number;
    items: { track: SpotifyTrack | null }[];
  };
}

export interface SpotifyDevice {
  id: string | null;
  is_active: boolean;
  name: string;
}

export interface SpotifyUser {
  id: string;
  display_name: string;
}

export interface SpotifyArtist {
  name: string;
  /** Feb 2026: Spotify ya no lo manda en modo desarrollo. */
  genres?: string[];
}

export interface SpotifyPlaylist {
  id: string;
  external_urls: { spotify: string };
}

export type TimeRange = "short_term" | "medium_term" | "long_term";

interface SpotifyClientOptions {
  clientId: string;
  clientSecret: string;
  accessToken: string;
  /** Vacío cuando el token vino de client_credentials (solo búsqueda). */
  refreshToken: string;
  expiresAt: number;
  /** Se llama cada vez que refrescamos el token, para persistirlo en disco. */
  onTokenRefresh?: (accessToken: string, expiresAt: number) => void;
}

/**
 * Agrega el filtro `year:` de Spotify a un query según el rango de años.
 * Acepta que venga solo el inicio, solo el fin, o ambos. Si no viene ninguno,
 * devuelve el query tal cual. Ordena los años por si llegan al revés.
 *
 *   conFiltroDeAnios("deep house", 2018, 2024) → "deep house year:2018-2024"
 *   conFiltroDeAnios("techno", 2020)           → "techno year:2020"
 */
export function conFiltroDeAnios(
  query: string,
  anioInicio?: number,
  anioFin?: number,
): string {
  if (!anioInicio && !anioFin) return query;
  const inicio = anioInicio ?? anioFin!;
  const fin = anioFin ?? anioInicio!;
  const [desde, hasta] = inicio <= fin ? [inicio, fin] : [fin, inicio];
  const filtro = desde === hasta ? `year:${desde}` : `year:${desde}-${hasta}`;
  return `${query} ${filtro}`.trim();
}

export class SpotifyClient {
  private accessToken: string;
  private expiresAt: number;
  private readonly refreshToken: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly onTokenRefresh?: (accessToken: string, expiresAt: number) => void;

  constructor(opts: SpotifyClientOptions) {
    this.clientId = opts.clientId;
    this.clientSecret = opts.clientSecret;
    this.accessToken = opts.accessToken;
    this.refreshToken = opts.refreshToken;
    this.expiresAt = opts.expiresAt;
    this.onTokenRefresh = opts.onTokenRefresh;
  }

  // ─── Auth ──────────────────────────────────────────────────────────────────

  /**
   * Renueva el access token. Con refresh token usa el grant refresh_token
   * (sesión de usuario); sin él cae a client_credentials (token de app,
   * solo lectura de catálogo).
   */
  private async refresh(): Promise<void> {
    const auth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64");
    const body = this.refreshToken
      ? new URLSearchParams({ grant_type: "refresh_token", refresh_token: this.refreshToken })
      : new URLSearchParams({ grant_type: "client_credentials" });
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    if (!res.ok) {
      throw new Error(`No se pudo refrescar el token: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as { access_token: string; expires_in: number };
    this.accessToken = data.access_token;
    this.expiresAt = Date.now() + data.expires_in * 1000;
    this.onTokenRefresh?.(this.accessToken, this.expiresAt);
  }

  /**
   * Hace una llamada autenticada a la Web API de Spotify.
   * Refresca el token si está por expirar y reintenta una vez ante un 401.
   */
  private async request<T>(
    path: string,
    options: {
      method?: string;
      body?: unknown;
      query?: Record<string, string | number>;
    } = {}
  ): Promise<T> {
    // Refresco proactivo: si el token vence en menos de 1 min, lo renovamos.
    if (Date.now() > this.expiresAt - 60000) {
      await this.refresh();
    }

    const url = new URL(`${API_BASE}${path}`);
    if (options.query) {
      for (const [key, value] of Object.entries(options.query)) {
        url.searchParams.set(key, String(value));
      }
    }

    const doFetch = () =>
      fetch(url, {
        method: options.method ?? "GET",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
        },
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      });

    let res = await doFetch();

    // El token pudo expirar a mitad de camino → refrescar y reintentar una vez.
    if (res.status === 401) {
      await this.refresh();
      res = await doFetch();
    }

    if (!res.ok) {
      throw new Error(`Spotify API ${res.status}: ${await res.text()}`);
    }

    // Varios endpoints (play, pause, next, addTracks) devuelven 204 sin cuerpo.
    if (res.status === 204) {
      return undefined as T;
    }
    // Solo parseamos si de verdad es JSON. Los comandos de player a veces
    // responden 200 con un cuerpo que no es JSON; esos devuelven void igual.
    const text = await res.text();
    if (!text) return undefined as T;
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) return undefined as T;
    return JSON.parse(text) as T;
  }

  // ─── Endpoints ───────────────────────────────────────────────────────────────

  async getMe(): Promise<SpotifyUser> {
    return this.request<SpotifyUser>("/me");
  }

  /**
   * Busca tracks. `limit` puede ser hasta 50 (máximo de Spotify) y `offset`
   * permite paginar para traer resultados distintos en llamadas sucesivas.
   * `market` acota al catálogo de un país (p. ej. "MX"), lo que cambia y
   * amplía la variedad de lo que devuelve.
   *
   * El `query` acepta la sintaxis de filtros de Spotify:
   *   "deep house genre:house year:2018-2024"
   */
  async searchTracks(
    query: string,
    limit = 10,
    offset = 0,
    market?: string,
  ): Promise<SpotifyTrack[]> {
    const params: Record<string, string | number> = {
      q: query,
      type: "track",
      limit: Math.min(Math.max(limit, 1), 50),
      offset: Math.min(Math.max(offset, 0), 1000),
    };
    if (market) params.market = market;
    const data = await this.request<{ tracks: { items: SpotifyTrack[] } }>("/search", {
      query: params,
    });
    return data.tracks?.items ?? [];
  }

  async getDevices(): Promise<SpotifyDevice[]> {
    const data = await this.request<{ devices: SpotifyDevice[] }>("/me/player/devices");
    return data.devices ?? [];
  }

  async play(deviceId: string, uris: string[]): Promise<void> {
    await this.request<void>("/me/player/play", {
      method: "PUT",
      query: { device_id: deviceId },
      body: { uris },
    });
  }

  /** Reproduce uris en el dispositivo activo (sin exigir device_id explícito). */
  async playUris(uris: string[], deviceId?: string): Promise<void> {
    await this.request<void>("/me/player/play", {
      method: "PUT",
      query: deviceId ? { device_id: deviceId } : undefined,
      body: { uris },
    });
  }

  /** ¿Está sonando esta canción ahorita? (204 sin cuerpo = no hay reproducción). */
  async isPlaying(uri: string): Promise<boolean> {
    const state = await this.getPlaybackState();
    return Boolean(state?.is_playing && state.item?.uri === uri);
  }

  // Feb 2026: Spotify quitó POST /users/{id}/playlists → ahora es POST /me/playlists.
  async createPlaylist(
    _userId: string,
    name: string,
    description: string,
    isPublic = false
  ): Promise<SpotifyPlaylist> {
    return this.request<SpotifyPlaylist>("/me/playlists", {
      method: "POST",
      body: { name, description, public: isPublic },
    });
  }

  // Feb 2026: /playlists/{id}/tracks se renombró a /playlists/{id}/items.
  async addTracksToPlaylist(playlistId: string, uris: string[]): Promise<void> {
    await this.request<void>(`/playlists/${playlistId}/items`, {
      method: "POST",
      body: { uris },
    });
  }

  async getTopArtists(limit = 10, timeRange: TimeRange = "medium_term"): Promise<SpotifyArtist[]> {
    const data = await this.request<{ items: SpotifyArtist[] }>("/me/top/artists", {
      query: { limit, time_range: timeRange },
    });
    return data.items ?? [];
  }

  async getTopTracks(limit = 10, timeRange: TimeRange = "medium_term"): Promise<SpotifyTrack[]> {
    const data = await this.request<{ items: SpotifyTrack[] }>("/me/top/tracks", {
      query: { limit, time_range: timeRange },
    });
    return data.items ?? [];
  }

  // ─── Playback (requiere Spotify Premium + dispositivo activo) ────────────────

  /** Estado actual de reproducción. Devuelve null si no hay nada sonando. */
  async getPlaybackState(): Promise<PlaybackState | null> {
    // /me/player devuelve 204 (sin cuerpo) cuando no hay dispositivo activo.
    const data = await this.request<PlaybackState | undefined>("/me/player");
    return data ?? null;
  }

  async pause(deviceId?: string): Promise<void> {
    await this.request<void>("/me/player/pause", {
      method: "PUT",
      query: deviceId ? { device_id: deviceId } : undefined,
    });
  }

  /** Reanuda la reproducción actual (sin cambiar de track). */
  async resume(deviceId?: string): Promise<void> {
    await this.request<void>("/me/player/play", {
      method: "PUT",
      query: deviceId ? { device_id: deviceId } : undefined,
    });
  }

  async next(deviceId?: string): Promise<void> {
    await this.request<void>("/me/player/next", {
      method: "POST",
      query: deviceId ? { device_id: deviceId } : undefined,
    });
  }

  async previous(deviceId?: string): Promise<void> {
    await this.request<void>("/me/player/previous", {
      method: "POST",
      query: deviceId ? { device_id: deviceId } : undefined,
    });
  }

  async seek(positionMs: number, deviceId?: string): Promise<void> {
    const query: Record<string, string | number> = { position_ms: Math.max(0, positionMs) };
    if (deviceId) query.device_id = deviceId;
    await this.request<void>("/me/player/seek", { method: "PUT", query });
  }

  async setVolume(volumePercent: number, deviceId?: string): Promise<void> {
    const query: Record<string, string | number> = {
      volume_percent: Math.min(100, Math.max(0, Math.round(volumePercent))),
    };
    if (deviceId) query.device_id = deviceId;
    await this.request<void>("/me/player/volume", { method: "PUT", query });
  }

  // ─── Playlists ───────────────────────────────────────────────────────────────

  /** Metadata completa de una playlist: nombre, cover, descripción y tracks. */
  async getPlaylist(playlistId: string): Promise<PlaylistFull> {
    return this.request<PlaylistFull>(`/playlists/${playlistId}`);
  }
}
