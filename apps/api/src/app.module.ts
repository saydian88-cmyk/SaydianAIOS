import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { AppController } from "./root.controller";
import { AiContentService } from "./ai-content.service";
import { AssetAiService } from "./asset-ai.service";
import { AuthService } from "./auth.service";
import { AutomationService } from "./automation.service";
import { BrandDataController } from "./brand-data.controller";
import { BrandDataService } from "./brand-data.service";
import { AliyunImsProvider, BailianVideoAiProvider, CloudMediaService } from "./cloud-media.service";
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
import { ViralCollectorService } from "./viral-collector.service";

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [AppController, HealthController, OpsController, BrandDataController],
  providers: [
    PrismaService, AuthService, PlatformRegistry, ContentGuardService, OssStorageService, SourceSyncService,
    AiContentService, ContentService, MonitoringService, ReportService, OperationsService, LedgerService, AutomationService,
    AliyunImsProvider, BailianVideoAiProvider, CloudMediaService, ViralCollectorService, AssetAiService, BrandDataService,
  ],
})
export class AppModule {}
