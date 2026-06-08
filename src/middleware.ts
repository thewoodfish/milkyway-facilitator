import { Request, Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";

export const rateLimiter = rateLimit({
  windowMs: 60 * 1000,   // 1 minute
  max:      200,          // 200 requests per minute per IP
  message:  { error: "Rate limit exceeded" }
});

// Per-address rate limit for /settle — 10 settlements per minute per payer wallet
const ADDRESS_MAX     = 10;
const ADDRESS_WINDOW  = 60_000;
const addressBuckets  = new Map<string, { count: number; resetAt: number }>();

export function checkAddressRateLimit(address: string): boolean {
  const now = Date.now();
  const key = address.toLowerCase();
  const bucket = addressBuckets.get(key);

  if (!bucket || now > bucket.resetAt) {
    addressBuckets.set(key, { count: 1, resetAt: now + ADDRESS_WINDOW });
    return true;
  }

  if (bucket.count >= ADDRESS_MAX) return false;
  bucket.count++;
  return true;
}

export function authenticateFacilitator(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const secret = process.env.FACILITATOR_SECRET;

  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      return res.status(503).json({ error: "Facilitator misconfigured — FACILITATOR_SECRET not set" });
    }
    return next();
  }

  const provided = req.headers["x-facilitator-secret"] as string;
  if (!provided || provided !== secret) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  next();
}
