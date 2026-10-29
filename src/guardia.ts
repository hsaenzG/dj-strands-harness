/**
 * 🛡️ Guardia de acciones: que el DJ no diga que hizo algo que no hizo.
 *
 * Nova Pro a veces "narra" una acción en vez de ejecutarla: busca 30 canciones,
 * responde "¡Listo, creé tu playlist!" con un link inventado y nunca llama
 * crear_playlist_en_spotify. Las instrucciones del prompt no bastan, así que lo
 * verificamos en código con hooks del Strands SDK:
 *
 *   - AfterToolCallEvent   → anotamos las playlists que de verdad se crearon.
 *   - AfterInvocationEvent → revisamos la respuesta final. Si promete una playlist
 *     que no existe, `event.resume` regresa al agente a su loop (en la misma
 *     invocación) con una corrección para que la cree de verdad.
 *
 * Como createHarness() devuelve un Agent normal del SDK, esto se le conecta con addHook().
 */

import { AfterInvocationEvent, AfterToolCallEvent, BeforeInvocationEvent, type Agent } from "@strands-agents/sdk";
import { sinThinking } from "./thinking.js";

/** Marca los mensajes de corrección para no mostrarlos como si los hubiera escrito el usuario. */
export const PREFIJO_GUARDIA = "[verificación automática]";

const LINK_PLAYLIST = /open\.spotify\.com\/playlist\/([A-Za-z0-9]+)/g;
// Fronteras de palabra que entienden acentos (\b de JS no considera letra a la "é").
const DICE_QUE_CREO = new RegExp(
  String.raw`(?<!\p{L})(he creado|ya cre[eé]|creé|armé|he armado|aqu[ií] est[aá] tu)(?!\p{L})[^.!?\n]{0,60}(?<!\p{L})(playlist|lista)(?!\p{L})` +
    String.raw`|(?<!\p{L})(playlist|lista)(?!\p{L})[^.!?\n]{0,40}(?<!\p{L})(creada|lista para)(?!\p{L})`,
  "iu",
);
const MAX_CORRECCIONES = 1;

function textoDe(content: readonly { type: string }[]): string {
  return content
    .filter((b) => b.type === "textBlock" || b.type === "toolResultBlock")
    .map((b: any) => b.text ?? JSON.stringify(b.content ?? ""))
    .join("\n");
}

export function agregarGuardia(agente: Agent): void {
  let creadas = new Set<string>(); // ids de playlists que el tool sí creó en este turno
  let correcciones = 0;
  let reanudando = false;

  agente.addHook(BeforeInvocationEvent, () => {
    // `resume` dispara otro BeforeInvocation: ahí NO reiniciamos la cuenta.
    if (reanudando) {
      reanudando = false;
      return;
    }
    creadas = new Set();
    correcciones = 0;
  });

  agente.addHook(AfterToolCallEvent, (event) => {
    if (event.toolUse.name !== "crear_playlist_en_spotify" || event.result.status !== "success") return;
    for (const m of textoDe([event.result]).matchAll(LINK_PLAYLIST)) creadas.add(m[1]);
  });

  agente.addHook(AfterInvocationEvent, (event) => {
    const ultimo = [...agente.messages].reverse().find((m) => m.role === "assistant");
    if (!ultimo || correcciones >= MAX_CORRECCIONES) return;

    const respuesta = sinThinking(textoDe(ultimo.content));
    const linksInventados = [...respuesta.matchAll(LINK_PLAYLIST)].filter((m) => !creadas.has(m[1]));
    const prometeSinCrear = creadas.size === 0 && DICE_QUE_CREO.test(respuesta);
    if (linksInventados.length === 0 && !prometeSinCrear) return;

    correcciones++;
    reanudando = true;
    event.resume = `${PREFIJO_GUARDIA} En este turno NO llamaste crear_playlist_en_spotify, así que la playlist no existe y cualquier link que diste es inventado. Llama ahora crear_playlist_en_spotify con las URIs reales (spotify:track:...) de tus búsquedas anteriores. Después responde al usuario solo con el link que devuelva la herramienta, sin mencionar esta verificación.`;
  });
}
