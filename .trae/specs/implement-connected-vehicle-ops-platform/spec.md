# 车联网运营管理平台 Spec

## Why
智能网联汽车运营团队需要统一的后端运营管理平台，对账号权限、车辆联网状态和告警数据进行精细化管理。平台同时为后续 AI 主动服务能力预留智能体中心入口。

## What Changes
- 新增汽车行业科技感登录页，支持账号、密码、随机 4 位验证码输入与错误提示。
- 新增本地 SQLite 数据库存储结构化数据。
- 新增超级管理员账号：`admin`，默认密码：`Test1234!`。
- 新增账号中心，包含用户管理与角色管理。
- 新增角色到系统功能模块的访问权限管理，模块包括账号中心、智能体中心。
- 新增平台总览，展示车辆关键指标、品牌在线车辆柱状图和当日小时级在线车辆曲线图。
- 新增智能体中心占位页面，作为后续扩展入口。

## Impact
- Affected specs: 登录认证、账号中心、权限管理、平台总览、智能体中心、数据存储。
- Affected code: 应用入口、路由、页面组件、SQLite 数据层、登录会话、用户/角色 CRUD、图表展示、初始化数据。

## ADDED Requirements
### Requirement: 登录页
The system SHALL provide a login page with automotive industry visual style and a technology-oriented interface.

#### Scenario: 登录成功
- **WHEN** 用户输入有效账号、密码和当前随机 4 位验证码并点击登录
- **THEN** 系统 SHALL 创建登录会话并进入平台总览

#### Scenario: 登录失败
- **WHEN** 用户输入错误账号、错误密码或错误验证码并点击登录
- **THEN** 系统 SHALL 显示重新输入提示并保持在登录页

#### Scenario: 验证码展示
- **WHEN** 用户打开登录页
- **THEN** 系统 SHALL 展示一个随机 4 位验证码供用户输入

### Requirement: SQLite 数据存储
The system SHALL use a local SQLite database to persist structured platform data.

#### Scenario: 首次启动初始化
- **WHEN** 系统首次启动且数据库不存在或缺少初始数据
- **THEN** 系统 SHALL 初始化必要表结构和超级管理员账号 `admin`

### Requirement: 超级管理员账号
The system SHALL provide a built-in super administrator account with username `admin` and password `Test1234!`.

#### Scenario: 管理员登录
- **WHEN** 用户使用 `admin` 和 `Test1234!` 以及正确验证码登录
- **THEN** 系统 SHALL 授予其访问所有系统功能模块的权限

### Requirement: 用户管理
The system SHALL provide create, read, update, and delete capabilities for users in the account center.

#### Scenario: 用户 CRUD
- **WHEN** 超级管理员进入用户管理
- **THEN** 系统 SHALL allow listing, creating, editing, and deleting users

### Requirement: 角色管理
The system SHALL provide create, read, update, and delete capabilities for roles in the account center.

#### Scenario: 角色 CRUD
- **WHEN** 超级管理员进入角色管理
- **THEN** 系统 SHALL allow listing, creating, editing, and deleting roles

### Requirement: 角色权限管理
The system SHALL support mapping roles to accessible system modules.

#### Scenario: 配置角色权限
- **WHEN** 超级管理员创建或编辑角色
- **THEN** 系统 SHALL allow selecting permissions for 账号中心 and 智能体中心

#### Scenario: 权限生效
- **WHEN** 用户登录后访问系统模块
- **THEN** 系统 SHALL only expose modules allowed by the user's assigned role

### Requirement: 平台总览
The system SHALL provide an overview dashboard for connected vehicle operations.

#### Scenario: 顶部指标展示
- **WHEN** 用户进入平台总览
- **THEN** 系统 SHALL display registered vehicle count, real-time connected vehicle count, and alert vehicle count in the first row

#### Scenario: 图表展示
- **WHEN** 用户进入平台总览
- **THEN** 系统 SHALL display a bar chart for connected vehicles by brand and a line chart for today's hourly online vehicle count

### Requirement: 智能体中心
The system SHALL provide a reserved agent center page.

#### Scenario: 占位页访问
- **WHEN** 用户拥有智能体中心权限并进入该模块
- **THEN** 系统 SHALL display an empty reserved page without functional operations
