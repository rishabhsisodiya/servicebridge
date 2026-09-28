import type { NextConfig } from "next";

/**
 * Security headers applied to every response. HSTS is production-only:
 * enabling it locally would pin the browser to https://localhost, which
 * serves plain HTTP in dev.
 */
async function headers() {
  const common = [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Frame-Options", value: "SAMEORIGIN" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  ];
  if (process.env.NODE_ENV === "production") {
    common.push({
      key: "Strict-Transport-Security",
      value: "max-age=31536000; includeSubDomains",
    });
  }
  return [{ source: "/(.*)", headers: common }];
}

const nextConfig: NextConfig = { headers };

export default nextConfig;
