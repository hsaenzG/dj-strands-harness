/**
 * Lee la memoria de largo plazo del harness: archivos markdown planos, nada mágico.
 * Lo usan el comando /memoria del CLI y el panel de memoria de la web.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface Recuerdo {
  archivo: string;
  texto: string;
}

export function leerRecuerdos(dir: string): Recuerdo[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((archivo) => ({ archivo, texto: readFileSync(join(dir, archivo), "utf-8").trim() }));
}
