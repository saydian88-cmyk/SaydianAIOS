import { spawn } from "node:child_process";
import { resolve } from "node:path";

const pnpmExecutable = String(process.env.PNPM_EXECUTABLE || (process.platform === "win32" ? "pnpm.cmd" : "pnpm"));
const repoPath = resolve(__dirname, "../../..");
const child = spawn(pnpmExecutable, ["--filter", "@saidian-ops/ai-task-worker", "start"], {
  cwd: repoPath,
  env: process.env,
  shell: process.platform === "win32" && /\.(cmd|bat)$/iu.test(pnpmExecutable),
  windowsHide: true,
  stdio: "inherit",
});

child.on("error", (error) => {
  process.stderr.write(`AI任务执行器启动失败：${error.message}\n`);
  process.exitCode = 1;
});

child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
