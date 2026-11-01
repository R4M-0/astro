// Verifies Astro access tokens (same JWT secret as apps/api) and resolves the caller's role
// and department scope in the X-Organization-Id tenant. Mirrors Astro's RBAC:
// org_admin / hr_manager see everyone, manager sees their department(s), others only themselves.
import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { pool, type Employee } from "./data.js";

export interface Ctx { userId: string; orgId: string; role: string; deptIds: Set<string>; selfRef: string | null }
declare global { namespace Express { interface Request { ctx: Ctx } } }

const FULL = new Set(["org_admin", "hr_manager"]);
export const canSeeGalaxy = (c: Ctx) => FULL.has(c.role) || c.role === "manager";
export const canReadMail = (c: Ctx) => FULL.has(c.role);
export const canAct = (c: Ctx) => FULL.has(c.role);
export const visibleTo = (c: Ctx) => (e: Employee) =>
  FULL.has(c.role) || (c.role === "manager" && !!e.departmentId && c.deptIds.has(e.departmentId)) || e.ref === c.selfRef;

export async function auth(req: Request, res: Response, next: NextFunction) {
  try {
    const token = req.headers.authorization?.replace(/^Bearer /, "");
    const orgId = req.header("x-organization-id");
    if (!token || !orgId) return res.status(401).json({ message: "Unauthorized" });
    const p = jwt.verify(token, process.env.JWT_ACCESS_SECRET!) as { sub: string; sid: string; type?: string };
    if (p.type) return res.status(401).json({ message: "Unauthorized" });
    const { rows } = await pool.query(
      `SELECT r.key AS role, m."departmentId", m."extraDepartmentIds",
              (SELECT e.reference FROM "Employee" e WHERE e."userId" = m."userId" AND e."organizationId" = m."organizationId" AND e."deletedAt" IS NULL LIMIT 1) AS "selfRef"
         FROM "Membership" m JOIN "Role" r ON r.id = m."roleId"
         JOIN "Session" s ON s.id = $3 AND s."userId" = m."userId" AND s."revokedAt" IS NULL AND s."expiresAt" > now()
        WHERE m."userId" = $1 AND m."organizationId" = $2 AND m."isActive" AND m."acceptedAt" IS NOT NULL AND m."deletedAt" IS NULL`,
      [p.sub, orgId, p.sid]);
    if (!rows.length) return res.status(403).json({ message: "Forbidden" });
    const r = rows[0];
    req.ctx = { userId: p.sub, orgId, role: r.role, deptIds: new Set([r.departmentId, ...(r.extraDepartmentIds ?? [])].filter(Boolean)), selfRef: r.selfRef };
    next();
  } catch {
    res.status(401).json({ message: "Unauthorized" });
  }
}

const hits = new Map<string, number[]>();
/** Per-user sliding-window rate limit for LLM endpoints. */
export const limit = (perMinute: number) => (req: Request, res: Response, next: NextFunction) => {
  const now = Date.now(), list = (hits.get(req.ctx.userId) ?? []).filter(t => now - t < 60000);
  if (list.length >= perMinute) return res.status(429).json({ message: "Too many requests" });
  list.push(now); hits.set(req.ctx.userId, list); next();
};
