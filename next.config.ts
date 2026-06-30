import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["leaflet", "react-leaflet", "@react-leaflet/core"],
  // ffmpeg-static resolves its binary path from its own __dirname. If Next
  // bundles it, that path breaks at runtime (spawn ENOENT on Vercel). Keep it
  // external so the require resolves the real node_modules path...
  serverExternalPackages: ["ffmpeg-static", "pdf-parse", "mammoth"],
  // ...and make sure the binary actually ships in the function bundle.
  outputFileTracingIncludes: {
    "/api/recordings/[id]/uploaded": ["./node_modules/ffmpeg-static/**"],
  },
};

export default nextConfig;
