import { onRequest } from "firebase-functions/v2/https";
import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import { randomUUID } from "crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createMcpServer } from "./server.js";

const app = express();
app.use(express.json());
app.use(cors());

// Persists in the single warm instance (minInstances: 1, maxInstances: 1).
const activeSessions: Record<string, StreamableHTTPServerTransport> = {};

// Express 4 does not propagate unhandled promise rejections in route handlers.
// This wrapper pipes async errors to Express's error-handling middleware.
function wrapAsync(
  fn: (req: Request, res: Response) => Promise<void>
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req, res).catch(next);
  };
}

function resolveSession(req: Request): StreamableHTTPServerTransport | undefined {
  // req.headers values can be string | string[] | undefined.
  // Take the first value when the header is sent more than once.
  const rawHeader = req.headers["mcp-session-id"];
  const sessionId = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
  return sessionId ? activeSessions[sessionId] : undefined;
}

function rejectMissingSession(res: Response): void {
  res.status(400).send("Invalid or missing session ID");
}

app.post("/", wrapAsync(async (req, res) => {
  const existingSession = resolveSession(req);

  if (existingSession) {
    await existingSession.handleRequest(req, res, req.body);
    return;
  }

  if (isInitializeRequest(req.body)) {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sessionId) => {
        activeSessions[sessionId] = transport;
      },
    });

    transport.onclose = () => {
      if (transport.sessionId) delete activeSessions[transport.sessionId];
    };

    await createMcpServer().connect(transport);
    await transport.handleRequest(req, res, req.body);
    return;
  }

  res.status(400).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Bad Request: No valid session" },
    id: null,
  });
}));

async function handleExistingSession(req: Request, res: Response): Promise<void> {
  const session = resolveSession(req);
  if (!session) { rejectMissingSession(res); return; }
  await session.handleRequest(req, res);
}

app.get("/", wrapAsync(handleExistingSession));
app.delete("/", wrapAsync(handleExistingSession));

// Catches errors forwarded by wrapAsync. Responds with a JSON-RPC error
// envelope so clients receive a structured failure instead of a hung request.
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error("Unhandled MCP transport error:", message);
  res.status(500).json({
    jsonrpc: "2.0",
    error: { code: -32603, message: "Internal error" },
    id: null,
  });
});

// NO app.listen() — Firebase Cloud Functions handles the HTTP listener.
export const mcp = onRequest(
  {
    minInstances: 1,   // always warm so activeSessions map survives between requests
    maxInstances: 1,   // all requests hit the same process — session map is valid
    concurrency: 80,
    timeoutSeconds: 3600,
    memory: "512MiB",
    region: "us-central1",
    secrets: ["GRAPH_API_KEY", "UNISWAP_API_KEY"],
  },
  app
);
