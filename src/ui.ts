/**
 * 🎨 Salida de la terminal: respuesta en verde, razonamiento tenue,
 * tools en fucsia y memoria en cian.
 */

import { leerRecuerdos } from "./memoria.js";
import { SeparadorDeThinking, type Pedazo } from "./thinking.js";

export const GREEN = "\x1b[92m";
export const YELLOW = "\x1b[93m";
export const MAGENTA = "\x1b[95m";
export const CYAN = "\x1b[96m";
export const DIM = "\x1b[2m";
export const RESET = "\x1b[0m";

type Streamable = { stream: (message: string) => AsyncGenerator<any, any, unknown> };

/**
 * Recorre el stream del agente: imprime el texto conforme llega y anuncia
 * cada tool que usa. `search_memory` es el tool que el harness agrega para
 * consultar la memoria de largo plazo, así que lo pintamos distinto.
 */
export async function streamColored(agent: Streamable, message: string): Promise<void> {
  process.stdout.write(`${GREEN}🤖 DJ: `);
  const separador = new SeparadorDeThinking();
  let anterior: Pedazo["tipo"] = "texto";

  const pintar = (pedazos: Pedazo[]) => {
    for (const { tipo, texto } of pedazos) {
      if (tipo !== anterior) process.stdout.write(tipo === "pensamiento" ? `\n${DIM}💭 ` : `${RESET}\n`);
      anterior = tipo;
      process.stdout.write(`${tipo === "pensamiento" ? DIM : GREEN}${texto}`);
    }
  };

  let pasadas = 0;
  for await (const event of agent.stream(message)) {
    if (event.type === "beforeInvocationEvent" && ++pasadas > 1) {
      // La guardia (src/guardia.ts) regresó al agente a su loop.
      pintar(separador.flush());
      anterior = "texto";
      process.stdout.write(`${RESET}\n\x1b[93m🛡️  Verificando: el DJ dijo que lo hizo, pero no llamó la herramienta${RESET}\n`);
    } else if (event.type === "modelStreamUpdateEvent") {
      const inner = event.event;
      if (inner?.type === "modelContentBlockDeltaEvent" && inner.delta?.type === "textDelta") {
        pintar(separador.push(inner.delta.text));
      }
    } else if (event.type === "beforeToolCallEvent") {
      pintar(separador.flush());
      anterior = "texto";
      const name: string = event.toolUse?.name ?? "desconocida";
      const color = name === "search_memory" ? CYAN : MAGENTA;
      const icono = name === "search_memory" ? "🧠" : "⚙ ";
      process.stdout.write(`${RESET}\n${color}${icono} ${name}${RESET}\n`);
    }
  }
  pintar(separador.flush());
  process.stdout.write(`${RESET}\n`);
}

/** Muestra los archivos de memoria de largo plazo. */
export function mostrarMemoria(dir: string): void {
  const recuerdos = leerRecuerdos(dir);
  if (recuerdos.length === 0) {
    console.log(`${CYAN}🧠 Todavía no hay recuerdos en ${dir}${RESET}`);
    return;
  }
  console.log(`${CYAN}🧠 Memoria de largo plazo (${dir}):${RESET}`);
  for (const { archivo, texto } of recuerdos) {
    console.log(`\n${CYAN}── ${archivo}${RESET}`);
    console.log(`${DIM}${texto}${RESET}`);
  }
}
