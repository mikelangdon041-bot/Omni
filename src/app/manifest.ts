import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Omni — Medical Affairs",
    short_name: "Omni",
    description: "All-in-one toolkit for Medical Science Liaisons.",
    start_url: "/",
    display: "standalone",
    background_color: "#031142",
    theme_color: "#031142",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
