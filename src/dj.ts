/**
 * 🎧 El DJ, armado con Strands Harness.
 *
 * Antes (Strands SDK) armábamos todo a mano: BedrockModel, SessionManager,
 * LocalFileStorage, el system prompt completo...
 * Ahora `createHarness()` trae todo eso listo y nosotros solo decimos
 * QUÉ es distinto en nuestro agente.
 *
 * Este mismo archivo lo usan el CLI (src/index.ts) y la web (web/).
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { configureLogging, createHarness } from "@strands-agents/harness";
import type { SpotifyClient } from "./spotify/client.js";
import { agregarGuardia } from "./guardia.js";
import { buscarCanciones } from "./tools/biblioteca.js";
import { spotifyTools } from "./tools/spotify.js";

// El agente corre en tu laptop; el modelo corre en la nube (Amazon Bedrock).
export const MODELO = process.env.DJ_MODEL ?? "bedrock/us.amazon.nova-pro-v1:0";

// Mismo id = misma conversación al volver a correr el programa.
export const SESION = process.env.DJ_SESSION_ID ?? "jsconf-mx";

// Sesiones y memoria en la raíz del proyecto, corra desde donde corra (CLI o web).
const AGENT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../.agent");
export const SESIONES_DIR = resolve(AGENT_DIR, "sessions");
export const MEMORIA_DIR = resolve(AGENT_DIR, "memory");

const INSTRUCCIONES = `Eres un DJ personal y curador musical con acceso real a Spotify.
Respondes en español, con onda y buen gusto musical. 🎸

Reglas:
- Si te piden REPRODUCIR algo, llama reproducir_cancion de inmediato.
- Si te piden una PLAYLIST, busca con buscar_en_spotify y luego crea con crear_playlist_en_spotify
  usando las URIs reales que devolvió la búsqueda. Comparte el link que te devuelva la herramienta.
- Nunca digas que hiciste algo (crear, reproducir, guardar) si no llamaste la herramienta que lo hace.
- No digas que guardaste algo en tu memoria: tu memoria se actualiza sola, en segundo plano.
- Si preguntan por música, busca primero; nunca inventes canciones, artistas ni URLs.
- Para conocer sus gustos usa mis_top_artistas o mis_top_canciones.
- Si Spotify no está conectado, usa buscar_canciones (la biblioteca local).
- Usa lo que recuerdas del usuario (géneros, artistas, moods que le gustan o no) para personalizar.
- Tu memoria de largo plazo está escrita en inglés y se busca por palabras clave. Cuando necesites
  los gustos del usuario, llama search_memory con palabras en inglés, por ejemplo:
  "user music likes dislikes genre artist".
- No pidas confirmación para reproducir, buscar o crear playlists: el usuario ya te lo pidió.`;

// Con Nova, la memoria extrae recuerdos con el mismo Nova Pro y el harness lo
// avisa. Es esperado, así que callamos solo ese aviso para la demo en vivo.
configureLogging({
  debug: () => {},
  info: () => {},
  warn: (...args: unknown[]) => {
    if (!String(args[0]).includes("web_fetch summarizer")) console.warn(...args);
  },
  error: (...args: unknown[]) => console.error(...args),
});

export async function crearDJ(sp: SpotifyClient | null, sesion = SESION) {
  const dj = await createHarness({
    model: MODELO,
    instructions: INSTRUCCIONES,
    tools: sp ? [...spotifyTools(sp), buscarCanciones] : [buscarCanciones],

    // Memoria de corto plazo: la conversación se guarda en .agent/sessions/<id>
    session: { id: sesion, dir: SESIONES_DIR },
    // Memoria de largo plazo: hechos sobre ti, en markdown, en .agent/memory
    memory: { dir: MEMORIA_DIR },

    // Un DJ no necesita shell ni editar archivos: apagamos los tools y plugins
    // de propósito general y nos quedamos solo con los nuestros.
    builtinTools: [],
    builtinPlugins: [],
    skills: false,

    // Nova Pro no soporta el caché automático de prompts que el harness prende por defecto.
    caching: false,
    // Pintamos la salida nosotros (ui.ts / la web), así que apagamos el printer del SDK.
    printer: false,
  });

  // Lo que regresa createHarness() es un Agent normal: le conectamos nuestra guardia.
  agregarGuardia(dj);
  return dj;
}
