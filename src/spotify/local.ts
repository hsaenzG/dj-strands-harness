/**
 * Reproducir una canción de forma confiable.
 *
 * A veces la Web API responde "204 OK" al play, pero la app de escritorio no
 * arranca (su conexión remota se queda dormida). Por eso verificamos que de
 * verdad esté sonando y, si no, en macOS usamos AppleScript: le habla a la app
 * local sin pasar por la nube de Spotify.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { SpotifyClient } from "./client.js";

const run = promisify(execFile);

export const SIN_DISPOSITIVO =
  "❌ No hay dispositivos activos de Spotify. Abre Spotify en tu celular o computadora e intenta de nuevo.";

export type Via = "spotify_connect" | "app_local_mac";

export async function reproducirEnMacLocal(uri: string): Promise<boolean> {
  // Solo URIs de track válidas: nada de texto libre dentro del AppleScript.
  if (process.platform !== "darwin" || !/^spotify:track:[A-Za-z0-9]+$/.test(uri)) return false;
  try {
    await run("osascript", ["-e", `tell application "Spotify" to play track "${uri}"`]);
    const { stdout } = await run("osascript", ["-e", 'tell application "Spotify" to player state as string']);
    return stdout.trim() === "playing";
  } catch {
    return false;
  }
}

/** Reproduce `uri` y confirma que suena. Lanza un Error con mensaje amigable si no se pudo. */
export async function reproducirUri(sp: SpotifyClient, uri: string): Promise<Via> {
  const devices = await sp.getDevices();
  if (devices.length === 0) {
    if (await reproducirEnMacLocal(uri)) return "app_local_mac";
    throw new Error(SIN_DISPOSITIVO);
  }
  const deviceId = devices.find((d) => d.is_active)?.id ?? devices[0].id;
  await sp.playUris([uri], deviceId ?? undefined);

  await new Promise((r) => setTimeout(r, 1500));
  if (await sp.isPlaying(uri)) return "spotify_connect";
  if (await reproducirEnMacLocal(uri)) return "app_local_mac";
  throw new Error(
    "⚠️ Spotify aceptó la orden pero no empezó a sonar. Abre Spotify y dale play a cualquier canción una vez, luego intenta de nuevo.",
  );
}
