// Purpose: Mount the access demo's minimal React entry inside Electron.

import { StrictMode } from "react";
import { ClerkProvider } from "@clerk/electron/react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./app";
import "./style.css";

const queryClient = new QueryClient();
const root = document.getElementById("root");
if (!root) throw new Error("Access demo root is missing");

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ClerkProvider
        publishableKey={window.accessDemo.publishableKey}
        allowedRedirectProtocols={["openchart-access:"]}
      >
        <App />
      </ClerkProvider>
    </QueryClientProvider>
  </StrictMode>,
);
