/**
 * Nova escribe su razonamiento entre <thinking>...</thinking> dentro del texto.
 * Este separador recibe el stream en pedazos y devuelve qué parte es
 * razonamiento y qué parte es respuesta. Las etiquetas pueden llegar partidas
 * entre chunks ("<think" + "ing>"), así que guarda en `pendiente` cualquier
 * final que podría ser el inicio de una etiqueta.
 *
 * Lo usan la terminal (src/ui.ts) y la web (web/src/pages/api/chat.ts).
 */

export type Pedazo = { tipo: "texto" | "pensamiento"; texto: string };

export class SeparadorDeThinking {
  private pendiente = "";
  private pensando = false;

  /** Mete un chunk y devuelve los pedazos que ya se pueden mostrar. */
  push(chunk: string): Pedazo[] {
    const salida: Pedazo[] = [];
    this.pendiente += chunk;

    while (this.pendiente) {
      const etiqueta = this.pensando ? "</thinking>" : "<thinking>";
      const i = this.pendiente.indexOf(etiqueta);
      if (i >= 0) {
        this.emitir(salida, this.pendiente.slice(0, i));
        this.pendiente = this.pendiente.slice(i + etiqueta.length);
        this.pensando = !this.pensando;
        continue;
      }
      // ¿El final del buffer podría ser el inicio de la etiqueta? Lo guardamos.
      let guardar = 0;
      for (let n = Math.min(etiqueta.length - 1, this.pendiente.length); n > 0; n--) {
        if (etiqueta.startsWith(this.pendiente.slice(-n))) {
          guardar = n;
          break;
        }
      }
      this.emitir(salida, this.pendiente.slice(0, this.pendiente.length - guardar));
      this.pendiente = this.pendiente.slice(this.pendiente.length - guardar);
      break;
    }
    return salida;
  }

  /** Suelta lo que quedó pendiente (fin del mensaje o antes de un tool). */
  flush(): Pedazo[] {
    const salida: Pedazo[] = [];
    this.emitir(salida, this.pendiente);
    this.pendiente = "";
    this.pensando = false;
    return salida;
  }

  /** ¿Estamos dentro de un bloque <thinking>? */
  get enThinking(): boolean {
    return this.pensando;
  }

  private emitir(salida: Pedazo[], texto: string): void {
    if (texto) salida.push({ tipo: this.pensando ? "pensamiento" : "texto", texto });
  }
}

/** Quita los bloques <thinking> de un texto completo (para el historial). */
export function sinThinking(texto: string): string {
  return texto.replace(/<thinking>[\s\S]*?<\/thinking>/gi, "").trim();
}
