const ETHEREUM_SUBGRAPH_ID = "5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV";
const BASE_SUBGRAPH_ID = "FUbEPQw1oMghy39fwWBFY5fE6MXPXZQtjncQy2cXdrNS";
const SEPOLIA_SUBGRAPH_ID = "B6dBMFhPkR2NAHp7DZEhFEnMFrSHoHioMkRFJSFVQDDE";
const SUBGRAPH_BASE_URL = "https://gateway.thegraph.com/api";

const CHAINS = ["ethereum", "base", "sepolia"] as const;
export type Chain = typeof CHAINS[number];

// Read at call-time so Firebase's deploy analyzer (which runs without secrets)
// does not crash the module during static analysis.
export function getChainSubgraphUrls(): Record<Chain, string> {
  const key = process.env.GRAPH_API_KEY;
  if (!key) throw new Error("Missing required environment variable: GRAPH_API_KEY");
  return {
    ethereum: `${SUBGRAPH_BASE_URL}/${key}/subgraphs/id/${ETHEREUM_SUBGRAPH_ID}`,
    base: `${SUBGRAPH_BASE_URL}/${key}/subgraphs/id/${BASE_SUBGRAPH_ID}`,
    sepolia: `${SUBGRAPH_BASE_URL}/${key}/subgraphs/id/${SEPOLIA_SUBGRAPH_ID}`,
  };
}
