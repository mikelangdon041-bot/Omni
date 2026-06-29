import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The /uploaded route shells out to the ffmpeg-static binary. Next's output
  // tracing can't see the runtime-resolved binary path, so include it explicitly
  // in that function's serverless bundle (required for it to run on Vercel).
  outputFileTracingIncludes: {
    "/api/recordings/[id]/uploaded": ["./node_modules/ffmpeg-static/ffmpeg*"],
  },
};

export default nextConfig;
