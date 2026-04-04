"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.mcp = void 0;
const https_1 = require("firebase-functions/v2/https");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const crypto_1 = require("crypto");
const streamableHttp_js_1 = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
const server_js_1 = require("./server.js");
const app = (0, express_1.default)();
app.use(express_1.default.json());
app.use((0, cors_1.default)());
// Persists in the single warm instance (minInstances: 1, maxInstances: 1).
const activeSessions = {};
// Express 4 does not propagate unhandled promise rejections in route handlers.
// This wrapper pipes async errors to Express's error-handling middleware.
function wrapAsync(fn) {
    return (req, res, next) => {
        fn(req, res).catch(next);
    };
}
function resolveSession(req) {
    // req.headers values can be string | string[] | undefined.
    // Take the first value when the header is sent more than once.
    const rawHeader = req.headers["mcp-session-id"];
    const sessionId = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    return sessionId ? activeSessions[sessionId] : undefined;
}
function rejectMissingSession(res) {
    res.status(400).send("Invalid or missing session ID");
}
app.post("/", wrapAsync(async (req, res) => {
    const existingSession = resolveSession(req);
    if (existingSession) {
        await existingSession.handleRequest(req, res, req.body);
        return;
    }
    if ((0, types_js_1.isInitializeRequest)(req.body)) {
        const transport = new streamableHttp_js_1.StreamableHTTPServerTransport({
            sessionIdGenerator: () => (0, crypto_1.randomUUID)(),
            onsessioninitialized: (sessionId) => {
                activeSessions[sessionId] = transport;
            },
        });
        transport.onclose = () => {
            if (transport.sessionId)
                delete activeSessions[transport.sessionId];
        };
        await (0, server_js_1.createMcpServer)().connect(transport);
        await transport.handleRequest(req, res, req.body);
        return;
    }
    res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Bad Request: No valid session" },
        id: null,
    });
}));
async function handleExistingSession(req, res) {
    const session = resolveSession(req);
    if (!session) {
        rejectMissingSession(res);
        return;
    }
    await session.handleRequest(req, res);
}
app.get("/", wrapAsync(handleExistingSession));
app.delete("/", wrapAsync(handleExistingSession));
// Catches errors forwarded by wrapAsync. Responds with a JSON-RPC error
// envelope so clients receive a structured failure instead of a hung request.
app.use((err, _req, res, _next) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Unhandled MCP transport error:", message);
    res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal error" },
        id: null,
    });
});
// NO app.listen() — Firebase Cloud Functions handles the HTTP listener.
exports.mcp = (0, https_1.onRequest)({
    minInstances: 1, // always warm so activeSessions map survives between requests
    maxInstances: 1, // all requests hit the same process — session map is valid
    concurrency: 80,
    timeoutSeconds: 3600,
    memory: "512MiB",
    region: "us-central1",
    secrets: ["GRAPH_API_KEY"],
}, app);
//# sourceMappingURL=index.js.map