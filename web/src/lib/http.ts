export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export const mensajeDeError = (e: unknown) => (e instanceof Error ? e.message : String(e));
