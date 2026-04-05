"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, createConfig, http } from "wagmi";
import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import { sepolia, ogGalileo } from "@/lib/chains";
import "@rainbow-me/rainbowkit/styles.css";

const wagmiConfig = createConfig({
  chains: [sepolia, ogGalileo],
  transports: {
    [sepolia.id]: http("https://ethereum-sepolia.publicnode.com"),
    [ogGalileo.id]: http("https://evmrpc-testnet.0g.ai"),
  },
  ssr: true,
});

const queryClient = new QueryClient();

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={darkTheme({ accentColor: "#7B3FE4" })}>
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
