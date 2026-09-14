import type { NextFunction, Request, RequestHandler, Response } from "express";

/** Error body shape from Docs/API-CONTRACT.md §7. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Express 4 does not catch rejected promises from async handlers; without this
 * a failed query hangs the request instead of returning 500.
 */
export function handler(fn: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return (req, res, next) => {
    fn(req, res).catch(next);
  };
}

export function errorMiddleware(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof ApiError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }
  console.error("unhandled error:", err);
  res.status(500).json({ error: { code: "internal", message: "internal error" } });
}

/** Clamp a client-supplied page size instead of trusting it. */
export function pageSize(raw: unknown, fallback: number, max: number): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

export function requireString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ApiError(400, `${field}_required`, `${field} must be a non-empty string`);
  }
  if (value.length > maxLength) {
    throw new ApiError(400, `${field}_too_long`, `${field} must be ${maxLength} characters or fewer`);
  }
  return value;
}
