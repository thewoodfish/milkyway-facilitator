import { Request, Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";

export const rateLimiter = rateLimit({
  windowMs: 60 * 1000,   // 1 minute
  max:      200,          // 200 requests per minute per IP
  message:  { error: "Rate limit exceeded" }
});

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
