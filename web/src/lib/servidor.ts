/**
 * Estado del servidor web: la conexión con Spotify y el DJ.
 *
 * El DJ es el MISMO agente que usa el CLI (src/dj.ts): mismo createHarness(),
 * misma carpeta .agent/. Si le cuentas algo en la terminal, la web lo recuerda.
 *
 * Guardamos el estado en globalThis para que sobreviva los recargos de Astro en dev.
 */

import "dotenv/config";
import { crearDJ, SESION } from "../../../src/dj.js";
import { PREFIJO_GUARDIA } from "../../../src/guardia.js";
import type { SpotifyClient } from "../../../src/spotify/client.js";
import { clientFromToken, loadToken } from "../../../src/spotify/oauth.js";
import { sinThinking } from "../../../src/thinking.js";

type DJ = Awaited<ReturnType<typeof crearDJ>>;

interface Estado {
  sp: SpotifyClient | null;
  spUser: string | null;
  spIntentado: boolean;
  dj: Promise<DJ> | null;
  sesion: string;
  ocupado: boolean;
  hooks: boolean;
}

const g = globalThis as typeof globalThis & { __djWeb?: Estado };
const estado: Estado = (g.__djWeb ??= {
  sp: null,
  spUser: null,
  spIntentado: false,
  dj: null,
  sesion: SESION,
  ocupado: false,
  hooks: false,
});

// ─── Spotify ─────────────────────────────────────────────────────────────────

/** Debe estar registrado en la app de Spotify. Spotify exige 127.0.0.1, no "localhost". */
export const REDIRECT_URI =
  process.env.SPOTIFY_REDIRECT_URI ?? "http://127.0.0.1:4321/api/spotify/callback";

/** Cliente de Spotify a partir del token guardado (lo deja el CLI o el login de la web). */
export async function getSpotify(): Promise<SpotifyClient | null> {
  if (estado.sp || estado.spIntentado) return estado.sp;
  estado.spIntentado = true;

  const { SPOTIFY_CLIENT_ID: id, SPOTIFY_CLIENT_SECRET: secret } = process.env;
  const token = loadToken();
  if (!id || !secret || !token) return null;

  try {
    const client = clientFromToken(id, secret, token);
    const me = await client.getMe(); // verifica el token y lo refresca si expiró
    estado.sp = client;
    estado.spUser = me.display_name ?? "tu cuenta";
    console.log(`[Spotify] ✅ Conectado como ${estado.spUser}`);
  } catch (e) {
    console.log(`[Spotify] Token inválido: ${e}`);
  }
  return estado.sp;
}

export async function spotifyStatus(): Promise<{ configured: boolean; user: string | null }> {
  await getSpotify();
  return {
    configured: Boolean(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET),
    user: estado.spUser,
  };
}

/** Tras un login nuevo: reconectar Spotify y rearmar el DJ con las tools de Spotify. */
export async function reconectarSpotify(): Promise<void> {
  estado.sp = null;
  estado.spUser = null;
  estado.spIntentado = false;
  await cerrarDJ();
}

// ─── DJ ──────────────────────────────────────────────────────────────────────

export function getDJ(): Promise<DJ> {
  // initialize() restaura la sesión guardada (si no, se restauraría hasta el primer mensaje).
  estado.dj ??= getSpotify()
    .then((sp) => crearDJ(sp, estado.sesion))
    .then(async (dj) => {
      await dj.initialize();
      return dj;
    });
  registrarApagado();
  return estado.dj;
}

export const sesionActual = () => estado.sesion;

/** Cierra el DJ actual. shutdown() termina de escribir la memoria de largo plazo. */
async function cerrarDJ(): Promise<void> {
  const dj = estado.dj;
  estado.dj = null;
  if (dj) await (await dj).shutdown().catch(() => {});
}

/** Empieza una conversación nueva: la memoria de corto plazo arranca vacía, la de largo plazo sigue. */
export async function nuevaSesion(): Promise<string> {
  await cerrarDJ();
  estado.sesion = `web-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}`;
  return estado.sesion;
}

/** Un solo mensaje a la vez: el agente no acepta dos streams en paralelo. */
export function tomarTurno(): boolean {
  if (estado.ocupado) return false;
  estado.ocupado = true;
  return true;
}
export function soltarTurno(): void {
  estado.ocupado = false;
}

/** La conversación guardada en la sesión, solo el texto que vio el usuario. */
export async function historial(): Promise<{ role: "user" | "assistant"; text: string }[]> {
  const dj = await getDJ();
  const salida: { role: "user" | "assistant"; text: string }[] = [];
  for (const m of dj.messages) {
    const text = sinThinking(
      m.content
        .filter((b) => b.type === "textBlock")
        .map((b) => (b as { text: string }).text)
        .join("\n"),
    );
    if (!text) continue;
    if (m.role === "user" && text.startsWith(PREFIJO_GUARDIA)) {
      // La corrección de la guardia no es del usuario, y lo que el DJ dijo antes era falso.
      if (salida.at(-1)?.role === "assistant") salida.pop();
      continue;
    }
    salida.push({ role: m.role === "user" ? "user" : "assistant", text });
  }
  return salida;
}

/** Al apagar el servidor (Ctrl+C) guardamos la memoria pendiente. */
function registrarApagado(): void {
  if (estado.hooks) return;
  estado.hooks = true;
  const apagar = async () => {
    console.log("\n🧠 Guardando lo que aprendí...");
    await cerrarDJ();
    process.exit(0);
  };
  process.once("SIGINT", apagar);
  process.once("SIGTERM", apagar);
}
