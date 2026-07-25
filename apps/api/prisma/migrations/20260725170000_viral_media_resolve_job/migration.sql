CREATE TABLE "ViralMediaResolveJob" (
    "id" TEXT NOT NULL,
    "externalVideoId" TEXT NOT NULL,
    "status" "CloudMediaJobStatus" NOT NULL DEFAULT 'PENDING',
    "provider" TEXT,
    "analyze" BOOLEAN NOT NULL DEFAULT false,
    "idempotencyKey" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 4,
    "nextAttemptAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ViralMediaResolveJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ViralMediaResolveJob_externalVideoId_key"
ON "ViralMediaResolveJob"("externalVideoId");

CREATE UNIQUE INDEX "ViralMediaResolveJob_idempotencyKey_key"
ON "ViralMediaResolveJob"("idempotencyKey");

CREATE INDEX "ViralMediaResolveJob_status_nextAttemptAt_createdAt_idx"
ON "ViralMediaResolveJob"("status", "nextAttemptAt", "createdAt");

ALTER TABLE "ViralMediaResolveJob"
ADD CONSTRAINT "ViralMediaResolveJob_externalVideoId_fkey"
FOREIGN KEY ("externalVideoId") REFERENCES "ExternalVideo"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
