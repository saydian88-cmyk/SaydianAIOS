import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { AppController } from "./root.controller";
import { AiContentService } from "./ai-content.service";
import { AiTaskCenterController } from "./ai-task-center.controller";
import { AiTaskCenterService } from "./ai-task-center.service";
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
import { OperationAnalysisController } from "./operation-analysis.controller";
import { OperationAnalysisService } from "./operation-analysis.service";
import { DouyinIntegrationController } from "./douyin-integration.controller";
import { DouyinIntegrationService } from "./douyin-integration.service";
import { OssStorageService } from "./oss-storage.service";
import { OperationsService } from "./operations.service";
import { PlatformRegistry } from "./platform/platform.adapters";
import { PrismaService } from "./prisma.service";
import { ReportService } from "./report.service";
import { SourceSyncService } from "./source-sync.service";
import { SmartKeywordService } from "./smart-keyword.service";
import { SystemConfigController } from "./system-config.controller";
import { SystemConfigService } from "./system-config.service";
import { ViralCollectorService } from "./viral-collector.service";
import { ViralTrendService } from "./viral-trend.service";
import { VideoFactoryController } from "./video-factory.controller";
import { VideoFactoryService } from "./video-factory.service";
import { VideoFactoryWorkerService } from "./video-factory-worker.service";
import { AdminV2Controller, WorkbenchController } from "./workbench.controller";
import { WorkbenchService } from "./workbench.service";
import { WecomNotificationService } from "./wecom-notification.service";

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [
    AppController, HealthController, OpsController, BrandDataController,
    OperationAnalysisController, DouyinIntegrationController, VideoFactoryController,
    WorkbenchController, AdminV2Controller, AiTaskCenterController, SystemConfigController,
  ],
  providers: [
    PrismaService, AuthService, PlatformRegistry, ContentGuardService, OssStorageService, SourceSyncService,
    AiContentService, ContentService, MonitoringService, ReportService, OperationsService, LedgerService, AutomationService,
    AliyunImsProvider, BailianVideoAiProvider, CloudMediaService, ViralCollectorService, AssetAiService, BrandDataService,
    OperationAnalysisService, DouyinIntegrationService, SmartKeywordService, ViralTrendService,
    VideoFactoryService, VideoFactoryWorkerService,
    WorkbenchService, WecomNotificationService, AiTaskCenterService, SystemConfigService,
  ],
})
export class AppModule {}
