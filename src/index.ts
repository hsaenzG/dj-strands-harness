/**
 * 🎧 DJ Agent con Strands Harness — JSConf MX
 *
 * Corre local en tu terminal; el modelo (Amazon Nova Pro) corre en Amazon Bedrock.
 *
 *   npm start
 *
 * Comandos: /memoria (ver la memoria de largo plazo) · salir
 */

import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { authenticateSpotify } from "./spotify/auth.js";
import type { SpotifyClient } from "./spotify/client.js";
import { crearDJ, MEMORIA_DIR, MODELO, SESION } from "./dj.js";
import { DIM, RESET, YELLOW, mostrarMemoria, streamColored } from "./ui.js";

// ─── Spotify (opcional: sin él, el DJ usa la biblioteca local) ───────────────

async function conectarSpotify(): Promise<SpotifyClient | null> {
  const { SPOTIFY_CLIENT_ID: id, SPOTIFY_CLIENT_SECRET: secret } = process.env;
  if (!id || !secret) {
    console.log("⚠️  Spotify no configurado: el DJ usará la biblioteca local.\n");
    return null;
  }
  try {
    return await authenticateSpotify(id, secret);
  } catch (e) {
    console.log(`⚠️  Spotify no disponible (${e}). Uso la biblioteca local.\n`);
    return null;
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

const dj = await crearDJ(await conectarSpotify());

console.log("\n🎧 DJ Agent · Strands Harness");
console.log(`${DIM}   modelo: ${MODELO} · sesión: ${dj.sessionId} · AWS: ${process.env.AWS_PROFILE ?? "default"}${RESET}`);
console.log(`${DIM}   /memoria para ver lo que recuerdo · salir para terminar${RESET}\n`);

const rl = createInterface({ input: process.stdin, output: process.stdout });

while (true) {
  let mensaje: string;
  try {
    mensaje = (await rl.question(`${YELLOW}🎵 Tú: ${RESET}`)).trim();
  } catch {
    break; // Ctrl+C / Ctrl+D
  }
  if (mensaje === "") continue;
  if (/^(salir|exit|quit)$/i.test(mensaje)) break;
  if (mensaje === "/memoria") {
    mostrarMemoria(MEMORIA_DIR);
    continue;
  }

  try {
    await streamColored(dj, mensaje);
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    console.log(`\n⚠️  Error: ${msg}`);
    if (/expired|reauthenticate|credential/i.test(msg)) {
      const perfil = process.env.AWS_PROFILE ?? "default";
      console.log(`   Credenciales de AWS vencidas (perfil "${perfil}"). Corre: aws login --profile ${perfil}`);
    }
  }
}

rl.close();

// La memoria de largo plazo se extrae en segundo plano cada pocos turnos.
// shutdown() la termina de escribir antes de salir.
console.log(`\n${DIM}🧠 Guardando lo que aprendí de ti...${RESET}`);
await dj.shutdown();
console.log(`👋 ¡Nos vemos! Vuelve con la sesión "${SESION}" y sigo donde quedamos.`);
