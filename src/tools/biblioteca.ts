/**
 * Tool de la biblioteca LOCAL (data/canciones.json).
 * Funciona aunque Spotify no esté conectado: el plan B del demo.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tool } from "@strands-agents/sdk";
import { z } from "zod";

interface Cancion {
  titulo: string;
  artista: string;
  genero: string;
  mood: string;
  energia: number;
  duracion_min: number;
}

const __dirname = dirname(fileURLToPath(import.meta.url));

export const BIBLIOTECA: Cancion[] = JSON.parse(
  readFileSync(resolve(__dirname, "../../data/canciones.json"), "utf-8"),
);

// Quita acentos y pasa a minúsculas: "Melancólico" y "melancolico" son lo mismo.
const norm = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export const buscarCanciones = tool({
  name: "buscar_canciones",
  description:
    "Busca canciones en la biblioteca musical LOCAL del usuario por género, mood o artista.",
  inputSchema: z.object({
    genero: z.string().optional().describe("Género musical"),
    mood: z.string().optional().describe("Estado de ánimo"),
    artista: z.string().optional().describe("Nombre del artista"),
  }),
  callback: ({ genero, mood, artista }) => {
    const resultados = BIBLIOTECA.filter(
      (c) =>
        (!genero || norm(c.genero).includes(norm(genero))) &&
        (!mood || norm(c.mood).includes(norm(mood))) &&
        (!artista || norm(c.artista).includes(norm(artista))),
    );
    if (resultados.length === 0) {
      return "No encontré canciones con esos criterios en tu biblioteca local.";
    }
    return JSON.stringify(resultados.slice(0, 10), null, 2);
  },
});
