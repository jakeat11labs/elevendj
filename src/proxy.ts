import { auth } from "@/lib/auth/server";

// Next 16 auth wall. ElevenDJ is mostly public — only the host/admin surfaces
// require a session. The public request line, stage, and player stay open, and
// `/api/admin/*` routes self-guard with requireHost() so they return JSON 401s
// instead of an HTML redirect on fetch.
export const proxy = auth.middleware({ loginUrl: "/sign-in" });

export const config = {
  matcher: ["/host/:path*", "/admin/:path*"],
};
