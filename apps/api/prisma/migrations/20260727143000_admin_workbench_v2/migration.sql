ALTER TABLE "OpsTask"
  ADD COLUMN "requiredRoleCode" TEXT,
  ADD COLUMN "assignedBy" TEXT,
  ADD COLUMN "acceptedAt" TIMESTAMP(3),
  ADD COLUMN "startedAt" TIMESTAMP(3),
  ADD COLUMN "returnedAt" TIMESTAMP(3),
  ADD COLUMN "returnReason" TEXT,
  ADD COLUMN "reviewNote" TEXT,
  ADD COLUMN "reviewedAt" TIMESTAMP(3),
  ADD COLUMN "reviewedBy" TEXT,
  ADD COLUMN "taskTemplateId" TEXT;

CREATE TABLE "AdminUser" (
  "id" TEXT NOT NULL,
  "username" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "lastLoginAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Role" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "portal" TEXT NOT NULL,
  "permissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "dataScope" TEXT NOT NULL DEFAULT 'SELF',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AdminUserRole" (
  "adminUserId" TEXT NOT NULL,
  "roleId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminUserRole_pkey" PRIMARY KEY ("adminUserId", "roleId")
);

CREATE TABLE "EmployeeRole" (
  "employeeId" TEXT NOT NULL,
  "roleId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmployeeRole_pkey" PRIMARY KEY ("employeeId", "roleId")
);

CREATE TABLE "TaskTemplate" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "requiredRoleCode" TEXT NOT NULL,
  "description" TEXT,
  "checklist" JSONB NOT NULL DEFAULT '[]',
  "submissionSchema" JSONB NOT NULL DEFAULT '{}',
  "defaultPriority" TEXT NOT NULL DEFAULT 'MEDIUM',
  "defaultDueHours" INTEGER NOT NULL DEFAULT 24,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "roleId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TaskTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TaskAttachment" (
  "id" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "uploaderId" TEXT,
  "name" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "mimeType" TEXT,
  "size" INTEGER,
  "kind" TEXT NOT NULL DEFAULT 'REFERENCE',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TaskAttachment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TaskSubmission" (
  "id" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "summary" TEXT NOT NULL,
  "payload" JSONB NOT NULL DEFAULT '{}',
  "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TaskSubmission_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TaskReview" (
  "id" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "submissionId" TEXT,
  "action" TEXT NOT NULL,
  "reviewer" TEXT NOT NULL,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TaskReview_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TaskNotification" (
  "id" TEXT NOT NULL,
  "taskId" TEXT,
  "recipientEmployeeId" TEXT,
  "channel" TEXT NOT NULL DEFAULT 'IN_APP',
  "type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "readAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TaskNotification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdminUser_username_key" ON "AdminUser"("username");
CREATE INDEX "AdminUser_status_idx" ON "AdminUser"("status");
CREATE UNIQUE INDEX "Role_code_key" ON "Role"("code");
CREATE INDEX "Role_portal_active_idx" ON "Role"("portal", "active");
CREATE INDEX "AdminUserRole_roleId_idx" ON "AdminUserRole"("roleId");
CREATE INDEX "EmployeeRole_roleId_idx" ON "EmployeeRole"("roleId");
CREATE UNIQUE INDEX "TaskTemplate_code_key" ON "TaskTemplate"("code");
CREATE INDEX "TaskTemplate_requiredRoleCode_active_idx" ON "TaskTemplate"("requiredRoleCode", "active");
CREATE INDEX "TaskAttachment_taskId_createdAt_idx" ON "TaskAttachment"("taskId", "createdAt");
CREATE UNIQUE INDEX "TaskSubmission_taskId_version_key" ON "TaskSubmission"("taskId", "version");
CREATE INDEX "TaskSubmission_employeeId_createdAt_idx" ON "TaskSubmission"("employeeId", "createdAt");
CREATE INDEX "TaskReview_taskId_createdAt_idx" ON "TaskReview"("taskId", "createdAt");
CREATE INDEX "TaskNotification_recipientEmployeeId_readAt_createdAt_idx" ON "TaskNotification"("recipientEmployeeId", "readAt", "createdAt");
CREATE INDEX "TaskNotification_taskId_idx" ON "TaskNotification"("taskId");
CREATE INDEX "OpsTask_assigneeEmployeeId_status_dueAt_idx" ON "OpsTask"("assigneeEmployeeId", "status", "dueAt");
CREATE INDEX "OpsTask_requiredRoleCode_status_dueAt_idx" ON "OpsTask"("requiredRoleCode", "status", "dueAt");

UPDATE "OpsTask"
SET "assigneeEmployeeId" = NULL
WHERE "assigneeEmployeeId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "Employee" WHERE "Employee"."id" = "OpsTask"."assigneeEmployeeId"
  );

ALTER TABLE "AdminUserRole"
  ADD CONSTRAINT "AdminUserRole_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "AdminUserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EmployeeRole"
  ADD CONSTRAINT "EmployeeRole_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "EmployeeRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TaskTemplate"
  ADD CONSTRAINT "TaskTemplate_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "OpsTask"
  ADD CONSTRAINT "OpsTask_assigneeEmployeeId_fkey" FOREIGN KEY ("assigneeEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "OpsTask_taskTemplateId_fkey" FOREIGN KEY ("taskTemplateId") REFERENCES "TaskTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TaskAttachment"
  ADD CONSTRAINT "TaskAttachment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "OpsTask"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "TaskAttachment_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TaskSubmission"
  ADD CONSTRAINT "TaskSubmission_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "OpsTask"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "TaskSubmission_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TaskReview"
  ADD CONSTRAINT "TaskReview_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "OpsTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TaskNotification"
  ADD CONSTRAINT "TaskNotification_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "OpsTask"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "TaskNotification_recipientEmployeeId_fkey" FOREIGN KEY ("recipientEmployeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
