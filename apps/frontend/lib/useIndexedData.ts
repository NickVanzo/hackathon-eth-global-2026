"use client";

import { useState, useEffect } from "react";
import {
  fetchPositions,
  fetchIntents,
  fetchFeeEpochHistory,
  type IndexedPosition,
  type IndexedIntent,
  type FeeEpoch,
} from "./indexer";

export function useIndexedPositions(agentId?: number) {
  const [positions, setPositions] = useState<IndexedPosition[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      try {
        const data = await fetchPositions(agentId);
        if (!cancelled) setPositions(data);
      } catch {
        // Indexer may not be running — positions stay empty
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    load();
    const interval = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [agentId]);

  return { positions, isLoading };
}

export function useIndexedIntents(agentId?: number, limit = 50) {
  const [intents, setIntents] = useState<IndexedIntent[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      try {
        const data = await fetchIntents(agentId, limit);
        if (!cancelled) setIntents(data);
      } catch {
        // Indexer may not be running — intents stay empty
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    load();
    const interval = setInterval(load, 15_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [agentId, limit]);

  return { intents, isLoading };
}

export function useFeeEpochHistory(limit = 20) {
  const [epochs, setEpochs] = useState<FeeEpoch[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      try {
        const data = await fetchFeeEpochHistory(limit);
        if (!cancelled) setEpochs(data);
      } catch {
        // Indexer may not be running — epochs stay empty
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    load();
    const interval = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [limit]);

  return { epochs, isLoading };
}
