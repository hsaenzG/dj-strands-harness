# 🎧 DJ Agent con Strands Harness

Un DJ personal que busca, reproduce y arma playlists en tu Spotify. Recuerda la conversación y lo que te gusta.

Es la nueva versión del demo de [OpenSource-agents-demo](https://github.com/hsaenzG/OpenSource-agents-demo): allá construimos el agente capa por capa con el Strands SDK; acá usamos [Strands Harness](https://www.npmjs.com/package/@strands-agents/harness), que ya trae el loop, las sesiones y la memoria listas.

- **El agente corre local**, en tu laptop (Node + TypeScript).
- **El modelo corre en la nube**: Amazon Nova Pro en Amazon Bedrock.
- **Dos interfaces, un solo agente**: la terminal (`npm start`) y la app web en Astro (`npm run web`) usan el mismo [`src/dj.ts`](src/dj.ts) y la misma carpeta `.agent/`. Lo que le cuentas al DJ en una, lo recuerda en la otra.

## Antes vs. ahora

Con el SDK, la memoria de la capa 4 se armaba a mano:

```ts
const modelo = new BedrockModel({ modelId: "us.amazon.nova-pro-v1:0", region: "us-east-1" });
const sessionManager = new SessionManager({
  sessionId: "usuario-1",
  storage: new LocalFileStorage(resolve(__dirname, "../sesiones")),
});
const dj = new Agent({ model: modelo, systemPrompt, tools, sessionManager });
```

Y solo era memoria de corto plazo (la conversación). Con el harness ([`src/dj.ts`](src/dj.ts)):

```ts
const dj = await createHarness({
  model: "bedrock/us.amazon.nova-pro-v1:0",
  instructions: INSTRUCCIONES,
  tools: [...spotifyTools(sp), buscarCanciones],
  session: { id: "jsconf-mx", dir: SESIONES_DIR }, // memoria de corto plazo
  memory: { dir: MEMORIA_DIR },                    // memoria de largo plazo
  builtinTools: [],    // un DJ no necesita shell ni editar archivos
  builtinPlugins: [],
  skills: false,
  caching: false,      // Nova Pro no soporta el caché automático del harness
  printer: false,      // la salida la pintamos nosotros (terminal y web)
});

agregarGuardia(dj);    // es un Agent normal del SDK: le conectamos hooks propios
```

## Las dos memorias

| | Corto plazo (sesión) | Largo plazo (memoria) |
|---|---|---|
| Qué guarda | La conversación completa | Hechos sobre ti: géneros, artistas, moods |
| Dónde | `.agent/sessions/<id>/` | `.agent/memory/*.md` (markdown plano) |
| Cuándo | Después de cada mensaje | En segundo plano, cada pocos turnos |
| Cómo vuelve | Mismo id de sesión = sigue la plática | Se inyecta antes de cada turno + tool `search_memory` |
| Para empezar de cero | Otro `DJ_SESSION_ID` o "✨ Nueva sesión" en la web | Borra `.agent/memory/` |

La memoria de largo plazo sobrevive aunque cambies de sesión: abre una sesión nueva y el DJ igual sabe qué te gusta. En la terminal, `/memoria` muestra los archivos; en la web están en el panel "Memoria".

> **Ojo:** el harness escribe los recuerdos en inglés ("The user dislikes reggaeton.") y los busca por coincidencia de palabras, no por significado. Si el modelo busca "gustos musicales", no encuentra nada. Por eso las instrucciones del DJ le piden buscar en su memoria con palabras en inglés.

## 🛡️ La guardia: que no diga que hizo algo que no hizo

Nova Pro a veces narra una acción en vez de ejecutarla: busca 30 canciones, responde "¡Listo, creé tu playlist!" con un link inventado y nunca llama `crear_playlist_en_spotify`. Las instrucciones del prompt no bastan, así que [`src/guardia.ts`](src/guardia.ts) lo verifica en código con hooks del SDK:

- `AfterToolCallEvent` anota las playlists que de verdad se crearon.
- `AfterInvocationEvent` revisa la respuesta final. Si promete una playlist que no existe, `event.resume` regresa al agente a su loop (en la misma invocación) para que la cree de verdad. Máximo una corrección por turno.

En la terminal y en la web se ve como "🛡️ Verificando…" y el texto falso se reemplaza.

## Requisitos

- Node.js 22.23+
- Cuenta de AWS con acceso a Amazon Nova Pro en Bedrock (`us-east-1`)
- (Opcional) App de [Spotify Developer](https://developer.spotify.com/dashboard). Reproducir requiere Spotify Premium y Spotify abierto en algún dispositivo.

## Cómo correrlo

```bash
npm install
cp .env.example .env   # SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET y AWS_PROFILE
aws login              # credenciales para Bedrock
npm start              # terminal
npm run web            # app web → http://127.0.0.1:4321
```

En la app de Spotify registra los dos Redirect URIs (Spotify ya no acepta `localhost`, tiene que ser `127.0.0.1`):

- Terminal: `http://127.0.0.1:8000/callback`
- Web: `http://127.0.0.1:4321/api/spotify/callback`

Las dos guardan el token en el mismo `.spotify_token.json`: si autorizas en una, la otra ya queda conectada. En la web, si no hay token, aparece el botón "🔗 Conectar mi Spotify".

Sin Spotify configurado, el DJ usa la biblioteca local de `data/canciones.json`.

### La app web

Chat con streaming en vivo (razonamiento de Nova en 💭, un chip por cada tool), reproductor de Spotify abajo, tarjeta de cada playlist que crea el DJ y un panel con las dos memorias: la sesión actual con su historial y los recuerdos de `.agent/memory`. Al abrir la página se carga la conversación guardada de la sesión.

Corre con `astro dev` (igual que en el demo original). Al detener el servidor con Ctrl+C se guarda la memoria pendiente.

### Variables de entorno

| Variable | Default | Para qué |
|---|---|---|
| `DJ_MODEL` | `bedrock/us.amazon.nova-pro-v1:0` | Modelo, formato `proveedor/id` |
| `DJ_SESSION_ID` | `jsconf-mx` | Id de la conversación al arrancar |
| `AWS_REGION` | `us-east-1` | Región de Bedrock |
| `AWS_PROFILE` | `default` | Perfil de AWS con acceso a Nova Pro |
| `SPOTIFY_REDIRECT_URI` | `http://127.0.0.1:4321/api/spotify/callback` | Callback de la web |

### Detalles de Spotify que cambiaron en 2026

Spotify cambió su Web API en [febrero de 2026](https://developer.spotify.com/documentation/web-api/references/changes/february-2026). El demo original usaba endpoints que ya no existen; esta versión ya está migrada:

- Crear playlist: `POST /me/playlists` (antes `/users/{id}/playlists`).
- Agregar canciones: `POST /playlists/{id}/items` (antes `/tracks`), y en las playlists `tracks` ahora se llama `items`.
- La búsqueda trae máximo 10 resultados (con más devuelve `Invalid limit`); para traer más, el agente pagina con `offset`.

**Si Spotify dice "OK" pero no suena:** a veces la Web API acepta el play (204) y la app de escritorio no arranca. Al reproducir una canción verificamos que de verdad esté sonando y, si no, en macOS la reproducimos directo en la app local con AppleScript ([`src/spotify/local.ts`](src/spotify/local.ts)). La primera vez macOS puede pedir permiso para que la terminal controle Spotify.

## Guion sugerido para la demo

1. `npm start` → "Hola, me encanta el rock en español de los 90 y odio el reggaetón"
2. "Ponme algo de Caifanes" → reproduce en Spotify
3. `salir` → `npm run web` → la conversación de la terminal ya está en la web (misma sesión)
4. "Arma una playlist de 20 canciones para programar" → aparece la tarjeta de la playlist
5. "✨ Nueva sesión" → "¿Qué recuerdas de mí?" (sesión nueva, la memoria de largo plazo sigue)
6. Panel "Memoria" o `/memoria` → los recuerdos son archivos markdown, nada mágico

Antes de subir al escenario: borra `.agent/` para empezar limpio y corre `aws login --profile <tu-perfil>`.

## Estructura

```
src/                    # el agente (lo comparten la terminal y la web)
├── dj.ts               # ⭐ createHarness(): todo el agente
├── guardia.ts          # 🛡️ hooks que verifican las acciones del DJ
├── index.ts            # loop de la terminal
├── ui.ts               # colores y stream de la terminal
├── thinking.ts         # separa el <thinking> de Nova de la respuesta
├── memoria.ts          # lee .agent/memory
├── tools/
│   ├── spotify.ts      # buscar, reproducir, playlists, tops
│   └── biblioteca.ts   # biblioteca local (plan B sin Spotify)
└── spotify/            # cliente Spotify (fetch nativo), OAuth y plan B local en macOS
web/                    # app web (Astro)
├── astro.config.mjs
└── src/
    ├── lib/            # servidor.ts (DJ + Spotify), reproductor.ts
    └── pages/
        ├── index.astro # chat, reproductor, panel de memoria
        └── api/        # chat (SSE), memoria, playback, playlist, spotify/{login,callback,status}
data/canciones.json
.agent/                 # sesiones y memoria (se genera solo, no se sube)
```

## Recursos

- [Strands Harness (npm)](https://www.npmjs.com/package/@strands-agents/harness) · [harness-sdk en GitHub](https://github.com/strands-agents/harness-sdk)
- [Documentación de Strands Agents](https://strandsagents.com)
- [Amazon Nova](https://aws.amazon.com/ai/generative-ai/nova/) · [Spotify Web API](https://developer.spotify.com/documentation/web-api) · [Astro](https://astro.build/)
