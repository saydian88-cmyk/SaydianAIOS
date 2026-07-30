import { Logger, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AiContentService } from "./ai-content.service";
import { ContentGuardService } from "./content-guard.service";
import { OssStorageService } from "./oss-storage.service";
import { PrismaService } from "./prisma.service";
import { VideoFactoryWorkerService } from "./video-factory-worker.service";
import { VideoFactoryService } from "./video-factory.service";
import { WecomNotificationService } from "./wecom-notification.service";

@Module({
  providers: [
    PrismaService,
    AiContentService,
    ContentGuardService,
    OssStorageService,
    WecomNotificationService,
    VideoFactoryService,
    VideoFactoryWorkerService,
  ],
})
class VideoWorkerModule {}

async function bootstrap() {
  const logger = new Logger("VideoWorker");
  const app = await NestFactory.createApplicationContext(VideoWorkerModule, { logger: ["error", "warn", "log"] });
  const worker = app.get(VideoFactoryWorkerService);
  let active = true;

  const stop = async () => {
    active = false;
    await app.close();
    process.exit(0);
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  logger.log("智能视频工厂工作进程已启动");

  while (active) {
    try {
      const result = await worker.runOnce();
      await new Promise((resolve) => setTimeout(resolve, result ? 500 : 3_000));
    } catch (error) {
      logger.error(error instanceof Error ? error.stack || error.message : "工作进程执行失败");
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
  }
}

void bootstrap();
