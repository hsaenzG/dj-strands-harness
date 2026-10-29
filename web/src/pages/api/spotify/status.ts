/** GET /api/spotify/status → { configured, user } para el panel de estado. */

import type { APIRoute } from "astro";
import { json } from "../../../lib/http.js";
import { spotifyStatus } from "../../../lib/servidor.js";

export const GET: APIRoute = async () => json(await spotifyStatus());
