import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { parseServerArgs, setLogLevel, log } from "./options.js";
import { createResourceLoader } from "./resource-loader.js";
import { AgentManager } from "./agent-manager.js";
import { WsHandler } from "./ws-handler.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, "..", "public");
const PORT = 3000;

async function main() {
  const opts = parseServerArgs();
  setLogLevel(opts.logLevel);

  log.info(`Pi Agent server starting (provider=${opts.provider}, model=${opts.model})`);

  // -------------------------------------------------------------------------
  // Initialise pi agent
  // -------------------------------------------------------------------------
  const resourceLoader = await createResourceLoader();
  const agentManager = new AgentManager(
    opts.provider,
    opts.model,
    resourceLoader
  );
  await agentManager.init();

  // -------------------------------------------------------------------------
  // HTTP server — Express
  // -------------------------------------------------------------------------
  const app = express();

  // HA Ingress injects an X-Ingress-Path header with the base path.
  // We normalise it so the app works both with and without ingress.
  app.use((req, _res, next) => {
    const ingressPath = (req.headers["x-ingress-path"] as string) ?? "";
    // Strip the ingress prefix from the request URL so Express routes normally
    if (ingressPath && req.url.startsWith(ingressPath)) {
      req.url = req.url.slice(ingressPath.length) || "/";
    }
    next();
  });

  // Serve static frontend files
  app.use(express.static(PUBLIC_DIR));

  // SPA fallback — serve index.html for all non-asset routes
  app.get("*", (_req, res) => {
    res.sendFile(join(PUBLIC_DIR, "index.html"));
  });

  // -------------------------------------------------------------------------
  // WebSocket server
  // -------------------------------------------------------------------------
  const httpServer = createServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  wss.on("connection", (ws, req) => {
    log.info(`WebSocket client connected (${req.socket.remoteAddress})`);
    new WsHandler(ws, agentManager);
    ws.on("close", () =>
      log.info(`WebSocket client disconnected (${req.socket.remoteAddress})`)
    );
  });

  // -------------------------------------------------------------------------
  // Start listening
  // -------------------------------------------------------------------------
  httpServer.listen(PORT, "0.0.0.0", () => {
    log.info(`Server listening on http://0.0.0.0:${PORT}`);
  });

  // Graceful shutdown
  const shutdown = () => {
    log.info("Shutting down...");
    httpServer.close(() => process.exit(0));
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  console.error("[pi-agent] Fatal error:", err);
  process.exit(1);
});
