/**
 * Las dos memorias del harness, para el panel de la web.
 *   GET  /api/memoria → { sesion, historial, recuerdos }
 *   POST /api/memoria → empieza una sesión nueva (la memoria de largo plazo se queda)
 */

import type { APIRoute } from "astro";
import { MEMORIA_DIR } from "../../../../src/dj.js";
import { leerRecuerdos } from "../../../../src/memoria.js";
import { json, mensajeDeError } from "../../lib/http.js";
import { historial, nuevaSesion, sesionActual } from "../../lib/servidor.js";

export const GET: APIRoute = async () => {
  try {
    return json({
      sesion: sesionActual(), // corto plazo: .agent/sessions/<id>
      historial: await historial(),
      recuerdos: leerRecuerdos(MEMORIA_DIR), // largo plazo: .agent/memory/*.md
    });
  } catch (e) {
    return json({ sesion: sesionActual(), historial: [], recuerdos: [], error: mensajeDeError(e) });
  }
};

export const POST: APIRoute = async () => {
  try {
    return json({ sesion: await nuevaSesion() });
  } catch (e) {
    return json({ error: mensajeDeError(e) }, 500);
  }
};
