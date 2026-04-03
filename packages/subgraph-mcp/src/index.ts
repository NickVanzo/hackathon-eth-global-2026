// @agent-arena/subgraph-mcp entry point
import 'dotenv/config';

const port = parseInt(process.env.MCP_SERVER_PORT ?? '3001', 10);

async function main() {
  console.log('Subgraph MCP server starting on port', port);
}

main().catch(console.error);

