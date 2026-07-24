# 聚水潭办公电脑采集器

1. 将 `config.example.json` 复制为 `config.json`，填写导出目录。
2. 把中台登录令牌保存为用户环境变量 `SAIDIAN_OPS_TOKEN`。
3. 运行 `open-jushuitan-profile.ps1`，在独立 Chrome 配置中登录一次聚水潭。
4. 聚水潭报表导出到配置的 `ExportFolder`。CSV、JSON、XLSX 均可，XLSX 会通过本机 Excel 转换。
5. 管理员运行 `install-task.ps1`，每天 09:20 自动查重并导入。

采集器不会读取员工日常 Chrome。登录失效或没有新报表时，中台保留上次数据，并显示原数据周期，不会冒充当天数据。
