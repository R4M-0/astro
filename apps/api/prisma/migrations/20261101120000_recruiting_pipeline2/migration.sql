-- AlterTable
ALTER TABLE "Candidate" ADD COLUMN     "inviteStatus" TEXT NOT NULL DEFAULT 'NONE',
ADD COLUMN     "inviteToken" TEXT,
ADD COLUMN     "invitedAt" TIMESTAMP(3),
ADD COLUMN     "remindedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "JobOpening" ADD COLUMN     "closeDays" INTEGER NOT NULL DEFAULT 7,
ADD COLUMN     "reminderDays" INTEGER NOT NULL DEFAULT 3;

-- CreateTable
CREATE TABLE "InterviewSlot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "jobOpeningId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "durationMinutes" INTEGER NOT NULL DEFAULT 45,
    "location" TEXT,
    "interviewer" TEXT,
    "candidateId" TEXT,
    "bookedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "InterviewSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateMessage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "intent" TEXT,
    "needsHuman" BOOLEAN NOT NULL DEFAULT false,
    "summary" TEXT,
    "flags" JSONB NOT NULL DEFAULT '[]',
    "inReplyToId" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CandidateMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InterviewSlot_candidateId_key" ON "InterviewSlot"("candidateId");

-- CreateIndex
CREATE INDEX "InterviewSlot_organizationId_jobOpeningId_deletedAt_idx" ON "InterviewSlot"("organizationId", "jobOpeningId", "deletedAt");

-- CreateIndex
CREATE INDEX "CandidateMessage_organizationId_candidateId_idx" ON "CandidateMessage"("organizationId", "candidateId");

-- CreateIndex
CREATE INDEX "CandidateMessage_status_idx" ON "CandidateMessage"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Candidate_inviteToken_key" ON "Candidate"("inviteToken");

-- AddForeignKey
ALTER TABLE "InterviewSlot" ADD CONSTRAINT "InterviewSlot_jobOpeningId_fkey" FOREIGN KEY ("jobOpeningId") REFERENCES "JobOpening"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewSlot" ADD CONSTRAINT "InterviewSlot_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateMessage" ADD CONSTRAINT "CandidateMessage_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

