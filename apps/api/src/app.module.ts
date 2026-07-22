import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { AppController } from "./root.controller";
import { AuthService } from "./auth.service";
import { AutomationService } from "./automation.service";
import { ContentGuardService } from "./content-guard.service";
import { ContentService } from "./content.service";
import { HealthController, OpsController } from "./controllers";
import { LedgerService } from "./ledger.service";
import { MonitoringService } from "./monitoring.service";
import { OssStorageService } from "./oss-storage.service";
import { OperationsService } from "./operations.service";
import { PlatformRegistry } from "./platform/platform.adapters";
import { PrismaService } from "./prisma.service";
import { ReportService } from "./report.service";
import { SourceSyncService } from "./source-sync.service";

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [AppController, HealthController, OpsController],
  providers: [
    PrismaService, AuthService, PlatformRegistry, ContentGuardService, OssStorageService, SourceSyncService,
    ContentService, MonitoringService, ReportService, OperationsService, LedgerService, AutomationService,
  ],
})
export class AppModule {}
