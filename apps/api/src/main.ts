import "dotenv/config";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { opsConfig } from "./config";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.enableCors({ origin: true, credentials: false });
  app.setGlobalPrefix("");
  await app.listen(opsConfig.port, opsConfig.host);
  process.stdout.write(`赛电运营中台 API: http://${opsConfig.host}:${opsConfig.port}\n`);
}

void bootstrap();
