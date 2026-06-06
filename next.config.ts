import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lokal wird die App über 127.0.0.1:3000 aufgerufen (nie localhost — GoTrue-
  // Host-Falle, siehe docs/guides/auth-testing.md). Next 16 blockt sonst die
  // Dev-Ressourcen (HMR-WebSocket) als Cross-Origin → ständige Full-Reloads.
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
