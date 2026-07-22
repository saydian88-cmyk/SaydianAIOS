import { Controller, Get } from "@nestjs/common";

@Controller()
export class AppController {
  @Get()
  root() {
    return { service: "赛电电商运营中台", api: "/api/v1", health: "/health" };
  }
}

