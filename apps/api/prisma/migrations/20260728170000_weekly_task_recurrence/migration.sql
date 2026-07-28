CREATE TABLE "TaskRecurrence" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "descriptionDocument" JSONB,
    "expectedResult" TEXT,
    "expectedResultDocument" JSONB,
    "category" TEXT NOT NULL DEFAULT 'GENERAL',
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "creatorEmployeeId" TEXT NOT NULL,
    "assigneeEmployeeId" TEXT NOT NULL,
    "assignedByEmployeeId" TEXT,
    "assignedBy" TEXT,
    "sourceType" TEXT NOT NULL,
    "requiredRoleCode" TEXT,
    "weekdays" INTEGER[],
    "dueTime" TEXT NOT NULL DEFAULT '23:59',
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastGeneratedDate" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TaskRecurrence_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TaskRecurrence_active_assigneeEmployeeId_idx"
ON "TaskRecurrence"("active", "assigneeEmployeeId");

CREATE INDEX "TaskRecurrence_creatorEmployeeId_active_idx"
ON "TaskRecurrence"("creatorEmployeeId", "active");
