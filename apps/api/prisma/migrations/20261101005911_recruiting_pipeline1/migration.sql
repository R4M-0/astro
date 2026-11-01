-- CreateTable
CREATE TABLE "JobOpening" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "criteria" JSONB NOT NULL DEFAULT '[]',
    "retrievalSize" INTEGER NOT NULL DEFAULT 50,
    "shortlistSize" INTEGER NOT NULL DEFAULT 10,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "rankingStatus" TEXT NOT NULL DEFAULT 'IDLE',
    "rankingError" TEXT,
    "rankedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "JobOpening_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Candidate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "jobOpeningId" TEXT NOT NULL,
    "fullName" TEXT,
    "email" TEXT,
    "fileKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "error" TEXT,
    "cvText" TEXT,
    "guardFlags" JSONB NOT NULL DEFAULT '[]',
    "profile" JSONB,
    "retrievalScore" DOUBLE PRECISION,
    "dimsExplained" JSONB,
    "filterReasons" JSONB,
    "criteriaScores" JSONB,
    "justification" TEXT,
    "score" DOUBLE PRECISION,
    "rank" INTEGER,
    "shortlisted" BOOLEAN NOT NULL DEFAULT false,
    "decision" TEXT NOT NULL DEFAULT 'PENDING',
    "decisionReason" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Candidate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobOpening_organizationId_deletedAt_idx" ON "JobOpening"("organizationId", "deletedAt");

-- CreateIndex
CREATE INDEX "Candidate_organizationId_jobOpeningId_deletedAt_idx" ON "Candidate"("organizationId", "jobOpeningId", "deletedAt");

-- AddForeignKey
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_jobOpeningId_fkey" FOREIGN KEY ("jobOpeningId") REFERENCES "JobOpening"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
