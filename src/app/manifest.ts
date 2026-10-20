import type { MetadataRoute } from "next";

// PWA manifest (Phase 12). Installable; no offline caching (financial data must be live).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "WealthTrack",
    short_name: "WealthTrack",
    description: "Personal finance and portfolio tracker",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#2a78d6",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
