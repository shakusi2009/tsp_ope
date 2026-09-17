# Tasks
- [x] Task 1: 初始化应用工程与基础运行环境。
  - [x] SubTask 1.1: 选择并搭建适合本地后台管理平台的前后端结构。
  - [x] SubTask 1.2: 配置本地开发启动、构建和基础依赖。
  - [x] SubTask 1.3: 接入 SQLite 数据库文件、迁移或初始化脚本。

- [x] Task 2: 实现认证与登录页。
  - [x] SubTask 2.1: 创建科技感汽车行业风格登录界面。
  - [x] SubTask 2.2: 实现账号、密码、随机 4 位验证码输入。
  - [x] SubTask 2.3: 实现错误账号、错误密码、错误验证码的重新输入提示。
  - [x] SubTask 2.4: 初始化超级管理员账号 `admin` / `Test1234!` 并支持登录会话。

- [x] Task 3: 实现账号中心用户管理。
  - [x] SubTask 3.1: 设计用户数据表与用户列表接口或本地数据访问层。
  - [x] SubTask 3.2: 实现用户新增、查询、编辑、删除能力。
  - [x] SubTask 3.3: 在界面中提供用户管理列表、表单和操作反馈。

- [x] Task 4: 实现账号中心角色管理与权限控制。
  - [x] SubTask 4.1: 设计角色、角色权限、用户角色关联数据结构。
  - [x] SubTask 4.2: 实现角色新增、查询、编辑、删除能力。
  - [x] SubTask 4.3: 支持为角色配置账号中心、智能体中心访问权限。
  - [x] SubTask 4.4: 登录后根据角色权限控制导航和模块访问。

- [x] Task 5: 实现平台总览。
  - [x] SubTask 5.1: 设计车辆统计、品牌在线车辆数、小时级在线车辆数的数据结构或种子数据。
  - [x] SubTask 5.2: 展示注册车辆总数、实时联网车辆总数、告警车辆总数。
  - [x] SubTask 5.3: 使用柱状图展示不同品牌实时联网车辆数。
  - [x] SubTask 5.4: 使用曲线图展示今日每小时在线车辆总数变化。

- [x] Task 6: 实现智能体中心预留页面。
  - [x] SubTask 6.1: 添加智能体中心路由和导航入口。
  - [x] SubTask 6.2: 渲染空白预留内容，并受角色权限控制。

- [x] Task 7: 验证端到端功能。
  - [x] SubTask 7.1: 验证管理员登录、错误提示和验证码逻辑。
  - [x] SubTask 7.2: 验证用户管理和角色管理 CRUD。
  - [x] SubTask 7.3: 验证角色权限对账号中心、智能体中心访问控制生效。
  - [x] SubTask 7.4: 验证平台总览指标和图表正常展示。

# Task Dependencies
- Task 2 depends on Task 1.
- Task 3 depends on Task 1 and Task 2.
- Task 4 depends on Task 1, Task 2, and Task 3.
- Task 5 depends on Task 1 and Task 2.
- Task 6 depends on Task 2 and Task 4.
- Task 7 depends on Tasks 2, 3, 4, 5, and 6.
