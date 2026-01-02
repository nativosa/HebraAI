import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export const config = {
  matcher: ["/api/translate"],
};

export function middleware(req: NextRequest) {
  const user = process.env.TRANSLATE_BASIC_USER;
  const pass = process.env.TRANSLATE_BASIC_PASS;

  // If not configured, don't block (safer for troubleshooting),
  // but you can flip this to block instead.
  if (!user || !pass) return NextResponse.next();

  const auth = req.headers.get("authorization");

  if (!auth?.startsWith("Basic ")) {
    return new NextResponse("Authentication required", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="Translate API"' },
    });
  }

  const base64 = auth.slice("Basic ".length);
  const decoded = Buffer.from(base64, "base64").toString("utf8");
  const [u, p] = decoded.split(":");

  if (u === user && p === pass) {
    return NextResponse.next();
  }

  return new NextResponse("Unauthorized", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Translate API"' },
  });
}
