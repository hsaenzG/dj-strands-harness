/**
 * Chat con el DJ — streaming en tiempo real (Server-Sent Events).
 *
 * POST /api/chat { message } → eventos:
 *   { type: "tool", name }          el agente usa una herramienta
 *   { type: "thinking", delta }     razonamiento de Nova (<thinking>...</thinking>)
 *   { type: "text", delta }         la respuesta, conforme llega
 *   { type: "guard" }               la guardia corrigió al agente: descartar el texto previo
 *   { type: "done" }
 *   { type: "error", error }
 */

import type { APIRoute } from "astro";
import { SeparadorDeThinking, type Pedazo } from "../../../../src/thinking.js";
import { json, mensajeDeError } from "../../lib/http.js";
import { getDJ, soltarTurno, tomarTurno } from "../../lib/servidor.js";

export const POST: APIRoute = async ({ request }) => {
  const body = await request.json().catch(() => ({}));
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) return json({ error: "No se proporcionó un mensaje." }, 400);
  if (!tomarTurno()) return json({ error: "El DJ todavía está respondiendo el mensaje anterior." }, 409);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      const enviar = (pedazos: Pedazo[]) =>
        pedazos.forEach((p) => send({ type: p.tipo === "pensamiento" ? "thinking" : "text", delta: p.texto }));

      try {
        const dj = await getDJ();
        const separador = new SeparadorDeThinking();
        let pasadas = 0;

        for await (const event of dj.stream(message)) {
          if (event.type === "beforeInvocationEvent" && ++pasadas > 1) {
            // La guardia (src/guardia.ts) regresó al agente a su loop: lo de antes era falso.
            enviar(separador.flush());
            send({ type: "guard" });
          } else if (event.type === "beforeToolCallEvent") {
            enviar(separador.flush());
            send({ type: "tool", name: event.toolUse?.name ?? "tool" });
          } else if (event.type === "modelStreamUpdateEvent") {
            const inner = event.event;
            if (inner?.type === "modelContentBlockDeltaEvent" && inner.delta?.type === "textDelta") {
              enviar(separador.push(inner.delta.text));
            }
          }
        }
        enviar(separador.flush());
        send({ type: "done" });
      } catch (error) {
        let msg = mensajeDeError(error);
        if (/expired|reauthenticate|credential/i.test(msg)) {
          msg += ` → Corre: aws login --profile ${process.env.AWS_PROFILE ?? "default"}`;
        }
        send({ type: "error", error: `Error del agente: ${msg}` });
      } finally {
        soltarTurno();
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
};
