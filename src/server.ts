import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { AuthStorage } from "@mariozechner/pi-coding-agent";
import { parseServerArgs, setLogLevel, log, PATHS } from "./options";
import { createResourceLoader } from "./resource-loader";
import { AgentManager } from "./agent-manager";
import { LoginManager } from "./login-manager";
import { WsHandler } from "./ws-handler";

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
  const authStorage = AuthStorage.create(`${PATHS.piAgentDir}/auth.json`);
  const loginManager = new LoginManager(authStorage);
  const agentManager = new AgentManager(
    opts.provider,
    opts.model,
    resourceLoader,
    authStorage
  );

  let initError: string | null = null;
  try {
    await agentManager.init();
  } catch (err) {
    initError = err instanceof Error ? err.message : String(err);
    log.error("Agent failed to initialise:", initError);
    log.error("The web UI will still load — fix the configuration and restart the add-on.");
  }

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

  // Use noServer mode so we can manually handle the upgrade event and strip
  // the HA Ingress path prefix before matching — the ws library's built-in
  // path matching runs before Express middleware so it would never see /ws.
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (request, socket, head) => {
    const ingressPath = (request.headers["x-ingress-path"] as string) ?? "";
    const rawPath = request.url ?? "/";
    const path = ingressPath && rawPath.startsWith(ingressPath)
      ? rawPath.slice(ingressPath.length) || "/"
      : rawPath;

    if (path === "/ws") {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  wss.on("connection", (ws, req) => {
    log.info(`WebSocket client connected (${req.socket.remoteAddress})`);
    // If init failed and the agent still has no session, immediately tell the client
    // so it shows in the UI. Once auth changes allow a successful retry, this stops
    // firing because the agent will have a live session again.
    if (initError && !agentManager.getState()) {
      ws.send(JSON.stringify({ type: "error", message: `Agent init failed: ${initError}` }));
    }
    // Send auth status so the UI shows provider connection state immediately
    const handler = new WsHandler(ws, agentManager, loginManager);
    void handler; // handler registers itself via ws events
    ws.send(JSON.stringify({ type: "auth_status", providers: loginManager.getProviders() }));
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
