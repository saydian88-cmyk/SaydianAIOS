ALTER TABLE "Employee" ADD COLUMN "supervisorEmployeeId" TEXT;
ALTER TABLE "Employee" ADD COLUMN "collaborationNote" TEXT;
ALTER TABLE "OpsTask" ADD COLUMN "assignedByEmployeeId" TEXT;

CREATE TABLE "EmployeeReportingInvite" (
  "id" TEXT NOT NULL,
  "senderEmployeeId" TEXT NOT NULL,
  "recipientEmployeeId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "relationshipNote" TEXT,
  "respondedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmployeeReportingInvite_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Employee_supervisorEmployeeId_status_idx" ON "Employee"("supervisorEmployeeId", "status");
CREATE INDEX "OpsTask_assignedByEmployeeId_sourceType_status_dueAt_idx" ON "OpsTask"("assignedByEmployeeId", "sourceType", "status", "dueAt");
CREATE INDEX "EmployeeReportingInvite_senderEmployeeId_status_createdAt_idx" ON "EmployeeReportingInvite"("senderEmployeeId", "status", "createdAt");
CREATE INDEX "EmployeeReportingInvite_recipientEmployeeId_status_createdAt_idx" ON "EmployeeReportingInvite"("recipientEmployeeId", "status", "createdAt");

ALTER TABLE "Employee" ADD CONSTRAINT "Employee_supervisorEmployeeId_fkey"
  FOREIGN KEY ("supervisorEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OpsTask" ADD CONSTRAINT "OpsTask_assignedByEmployeeId_fkey"
  FOREIGN KEY ("assignedByEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EmployeeReportingInvite" ADD CONSTRAINT "EmployeeReportingInvite_senderEmployeeId_fkey"
  FOREIGN KEY ("senderEmployeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmployeeReportingInvite" ADD CONSTRAINT "EmployeeReportingInvite_recipientEmployeeId_fkey"
  FOREIGN KEY ("recipientEmployeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
