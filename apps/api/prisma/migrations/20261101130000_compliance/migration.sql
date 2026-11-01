-- CreateEnum
CREATE TYPE "RetentionCategory" AS ENUM ('CANDIDATE_NOT_HIRED', 'FORMER_EMPLOYEE', 'SURVEY_IDENTITY', 'AUDIT_LOG');

-- CreateEnum
CREATE TYPE "RetentionAction" AS ENUM ('ANONYMIZE', 'PURGE');

-- CreateEnum
CREATE TYPE "DataSubjectType" AS ENUM ('EMPLOYEE', 'CANDIDATE');

-- CreateEnum
CREATE TYPE "DsrType" AS ENUM ('ACCESS', 'ERASURE');

-- CreateEnum
CREATE TYPE "DsrStatus" AS ENUM ('OPEN', 'COMPLETED', 'REJECTED');

-- AlterTable
ALTER TABLE "AuditLogEntry" ADD COLUMN     "bodyDigest" TEXT,
ADD COLUMN     "hash" TEXT,
ADD COLUMN     "prevHash" TEXT,
ADD COLUMN     "redactedAt" TIMESTAMP(3),
ADD COLUMN     "seq" INTEGER;

-- AlterTable
ALTER TABLE "Candidate" ADD COLUMN     "anonymizedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "anonymizedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "AuditSeal" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "kind" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "hash" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditSeal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetentionPolicy" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "category" "RetentionCategory" NOT NULL,
    "retentionDays" INTEGER NOT NULL,
    "action" "RetentionAction" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RetentionPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetentionRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "dryRun" BOOLEAN NOT NULL,
    "results" JSONB NOT NULL DEFAULT '{}',
    "triggeredById" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "RetentionRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataSubjectRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "type" "DsrType" NOT NULL,
    "subjectType" "DataSubjectType" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "subjectLabel" TEXT NOT NULL,
    "requesterEmail" TEXT,
    "channel" TEXT,
    "notes" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" "DsrStatus" NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "result" JSONB,
    "completedAt" TIMESTAMP(3),
    "completedById" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "DataSubjectRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalHold" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "subjectType" "DataSubjectType" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "subjectLabel" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),
    "releasedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LegalHold_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditSeal_organizationId_createdAt_idx" ON "AuditSeal"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RetentionPolicy_organizationId_category_key" ON "RetentionPolicy"("organizationId", "category");

-- CreateIndex
CREATE INDEX "RetentionRun_organizationId_startedAt_idx" ON "RetentionRun"("organizationId", "startedAt");

-- CreateIndex
CREATE INDEX "DataSubjectRequest_organizationId_status_dueAt_idx" ON "DataSubjectRequest"("organizationId", "status", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "DataSubjectRequest_organizationId_reference_key" ON "DataSubjectRequest"("organizationId", "reference");

-- CreateIndex
CREATE INDEX "LegalHold_organizationId_subjectType_subjectId_idx" ON "LegalHold"("organizationId", "subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "AuditLogEntry_organizationId_seq_idx" ON "AuditLogEntry"("organizationId", "seq");

-- CreateIndex
CREATE INDEX "AuditLogEntry_entityId_idx" ON "AuditLogEntry"("entityId");

-- ─────────────────────────── Tamper-evident audit trail (docs/compliance) ───────────────────────────
-- The chain is computed here, not in the application: every writer (API, worker, Galaxy service,
-- a raw INSERT) is chained the same way. Verification recomputes it in Node
-- (core/compliance/audit-chain.ts), so this function is not trusted by the verifier.

CREATE OR REPLACE FUNCTION audit_body_digest(b jsonb, a jsonb) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(sha256(convert_to(coalesce(b::text, '') || '|' || coalesce(a::text, ''), 'UTF8')), 'hex')
$$;

CREATE OR REPLACE FUNCTION audit_row_hash(
  prev text, seq int, id text, org text, actor text, action text, etype text, eid text,
  ip text, ua text, imp text, created timestamp, digest text
) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(sha256(convert_to(concat_ws('|',
    prev, seq::text, id, coalesce(org, ''), coalesce(actor, ''), action, coalesce(etype, ''), coalesce(eid, ''),
    coalesce(ip, ''), coalesce(ua, ''), coalesce(imp, ''), to_char(created, 'YYYY-MM-DD"T"HH24:MI:SS.MS'), digest
  ), 'UTF8')), 'hex')
$$;

CREATE OR REPLACE FUNCTION audit_chain_before_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  last_seq int;
  last_hash text;
BEGIN
  -- one writer at a time per organization chain (released at commit)
  PERFORM pg_advisory_xact_lock(hashtext('audit-chain:' || coalesce(NEW."organizationId", '')));
  IF NEW."organizationId" IS NULL THEN
    SELECT seq, hash INTO last_seq, last_hash FROM "AuditLogEntry"
      WHERE "organizationId" IS NULL AND seq IS NOT NULL ORDER BY seq DESC LIMIT 1;
  ELSE
    SELECT seq, hash INTO last_seq, last_hash FROM "AuditLogEntry"
      WHERE "organizationId" = NEW."organizationId" AND seq IS NOT NULL ORDER BY seq DESC LIMIT 1;
  END IF;
  IF last_seq IS NULL THEN
    -- every row purged by retention: continue from the anchor seal
    SELECT seq, hash INTO last_seq, last_hash FROM "AuditSeal"
      WHERE "organizationId" IS NOT DISTINCT FROM NEW."organizationId" AND kind = 'ANCHOR'
      ORDER BY seq DESC LIMIT 1;
  END IF;
  NEW.seq := coalesce(last_seq, 0) + 1;
  NEW."prevHash" := coalesce(last_hash, repeat('0', 64));
  NEW."redactedAt" := NULL;
  NEW."bodyDigest" := audit_body_digest(NEW."before", NEW."after");
  NEW.hash := audit_row_hash(NEW."prevHash", NEW.seq, NEW.id, NEW."organizationId", NEW."actorId", NEW.action,
    NEW."entityType", NEW."entityId", NEW.ip, NEW."userAgent", NEW."impersonatedById", NEW."createdAt", NEW."bodyDigest");
  RETURN NEW;
END $$;

-- Backfill the chain over the rows written before this migration, oldest first.
DO $$
DECLARE
  r record;
  cur_org text := NULL;
  first boolean := true;
  s int;
  h text;
  d text;
BEGIN
  FOR r IN SELECT * FROM "AuditLogEntry" ORDER BY "organizationId" NULLS FIRST, "createdAt", id LOOP
    IF first OR r."organizationId" IS DISTINCT FROM cur_org THEN
      cur_org := r."organizationId"; s := 0; h := repeat('0', 64); first := false;
    END IF;
    s := s + 1;
    d := audit_body_digest(r."before", r."after");
    UPDATE "AuditLogEntry" SET seq = s, "prevHash" = h, "bodyDigest" = d,
      hash = audit_row_hash(h, s, r.id, r."organizationId", r."actorId", r.action, r."entityType", r."entityId",
        r.ip, r."userAgent", r."impersonatedById", r."createdAt", d)
      WHERE id = r.id RETURNING hash INTO h;
  END LOOP;
END $$;

CREATE TRIGGER audit_chain_before_insert BEFORE INSERT ON "AuditLogEntry"
  FOR EACH ROW EXECUTE FUNCTION audit_chain_before_insert();

-- Append-only. Two transaction-local exceptions (SET LOCAL):
--   astro.audit_redact = on    → UPDATE that only empties before/after and sets redactedAt (erasure)
--   astro.audit_retention = on → DELETE of old rows (retention, after an ANCHOR seal)
CREATE OR REPLACE FUNCTION audit_log_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('astro.audit_retention', true) = 'on' THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'AuditLogEntry is append-only (DELETE refused)' USING ERRCODE = '42501';
  END IF;
  IF current_setting('astro.audit_redact', true) = 'on'
     AND (NEW.id, NEW."organizationId", NEW."actorId", NEW.action, NEW."entityType", NEW."entityId", NEW.ip,
          NEW."userAgent", NEW."impersonatedById", NEW."createdAt", NEW.seq, NEW."bodyDigest", NEW."prevHash", NEW.hash)
         IS NOT DISTINCT FROM
         (OLD.id, OLD."organizationId", OLD."actorId", OLD.action, OLD."entityType", OLD."entityId", OLD.ip,
          OLD."userAgent", OLD."impersonatedById", OLD."createdAt", OLD.seq, OLD."bodyDigest", OLD."prevHash", OLD.hash)
     AND NEW."before" IS NULL AND NEW."after" IS NULL AND NEW."redactedAt" IS NOT NULL THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'AuditLogEntry is append-only (UPDATE refused)' USING ERRCODE = '42501';
END $$;

CREATE TRIGGER audit_log_guard BEFORE UPDATE OR DELETE ON "AuditLogEntry"
  FOR EACH ROW EXECUTE FUNCTION audit_log_guard();

CREATE OR REPLACE FUNCTION audit_refuse_truncate() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (TRUNCATE refused)', TG_TABLE_NAME USING ERRCODE = '42501';
END $$;

CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON "AuditLogEntry"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_refuse_truncate();

CREATE OR REPLACE FUNCTION audit_seal_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'AuditSeal is append-only' USING ERRCODE = '42501';
END $$;

CREATE TRIGGER audit_seal_guard BEFORE UPDATE OR DELETE ON "AuditSeal"
  FOR EACH ROW EXECUTE FUNCTION audit_seal_guard();

CREATE TRIGGER audit_seal_no_truncate BEFORE TRUNCATE ON "AuditSeal"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_refuse_truncate();
