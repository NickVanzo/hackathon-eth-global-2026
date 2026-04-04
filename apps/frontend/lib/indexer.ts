/**
 * indexer.ts — Hasura/Envio GraphQL client for indexed event data.
 *
 * The Envio indexer exposes a Hasura GraphQL endpoint. In development
 * this is accessed via ngrok, so the URL is configurable via env var.
 */

const HASURA_URL =
  process.env.NEXT_PUBLIC_HASURA_URL ?? "http://localhost:8080/v1/graphql";

const HASURA_ADMIN_SECRET =
  process.env.NEXT_PUBLIC_HASURA_ADMIN_SECRET ?? "testing";

async function hasuraQuery<T = unknown>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(HASURA_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-hasura-admin-secret": HASURA_ADMIN_SECRET,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new Error(`Hasura query failed: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  if (json.errors) {
    throw new Error(`Hasura GQL error: ${json.errors[0]?.message}`);
  }
  return json.data as T;
}

export interface PerformanceSnapshot {
  id: string;
  agentId: string;
  positionValue: string;
  feesCollected: string;
  cumulativeFees: string;
  blockNumber: string;
  blockTimestamp: string;
  returnBps: number;
}

interface PerformanceQueryResult {
  AgentPerformanceSnapshot: PerformanceSnapshot[];
}

export async function fetchAgentPerformanceHistory(
  agentId: number,
  limit = 100,
): Promise<PerformanceSnapshot[]> {
  const data = await hasuraQuery<PerformanceQueryResult>(
    `
    query AgentPerformance($agentId: numeric!, $limit: Int!) {
      AgentPerformanceSnapshot(
        where: { agentId: { _eq: $agentId } }
        order_by: { blockNumber: asc }
        limit: $limit
      ) {
        id
        agentId
        positionValue
        feesCollected
        cumulativeFees
        blockNumber
        blockTimestamp
        returnBps
      }
    }
    `,
    { agentId, limit },
  );
  return data.AgentPerformanceSnapshot;
}

// ---------------------------------------------------------------------------
// All agents performance (for leaderboard / aggregate view)
// ---------------------------------------------------------------------------

export async function fetchAllAgentsLatestPerformance(): Promise<
  PerformanceSnapshot[]
> {
  const data = await hasuraQuery<PerformanceQueryResult>(
    `
    query AllAgentsLatest {
      AgentPerformanceSnapshot(
        order_by: { blockNumber: desc }
        distinct_on: agentId
      ) {
        id
        agentId
        positionValue
        feesCollected
        cumulativeFees
        blockNumber
        blockTimestamp
        returnBps
      }
    }
    `,
  );
  return data.AgentPerformanceSnapshot;
}
