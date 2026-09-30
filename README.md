# 数控刀补复核台

操作员提交刀具编号与刀补微米值；后台 worker 用 PostgreSQL 行锁（`select_for_update(skip_locked=True)`）认领待复核记录，按绝对值是否不超过 12 微米给出「合格」或「超差」。

## 技术栈

| 层 | 选型 |
|----|------|
| 后端 | Django 5 + django-ninja（ASGI / uvicorn） |
| 前端 | SolidJS + Vite，nginx 反代 `/api` |
| 数据库 | PostgreSQL 16 |
| 鉴权 | JWT（python-jose），令牌存浏览器 localStorage |

## 端口

| 服务 | 地址 |
|------|------|
| 页面 | http://localhost:3196 |
| 接口 | http://localhost:8196 |
| PostgreSQL | localhost:54396（库名 `cncoffset`） |

## 账号

| 用户 | 密码 | 权限 |
|------|------|------|
| machinist | machine123456 | 可提交刀补、可签出连线台副本 |
| auditor | audit123456 | 只读：可看列表、在线轨迹与已签出副本，不能签出 |

## 启动

```bash
cd projects/17-cnc-tool-offset-desk
docker compose up --build
```

健康检查：`GET http://localhost:8196/api/health` → `{"status":"ok"}`

## 刀补连线台

导航「刀补连线台」（`#/trend`）把近几次**已结清**（已完成）刀补连成线：

- 顶部条数选择：近 5 / 10 / 20 次；点按 `-created_at` 排列，与首页复核列表**同一结清顺序**（图上按时间左→右展开），每 3 秒自动刷新在线轨迹。
- 圆点＝合格、方块＝超差（形状＋文字双重区分）；点表对照区可在两列里各挑一个点（第一点、第二点）。
- 差值由**后台**计算：`POST /api/trend/compare` 只收两个点 id，页面不自行相减；结果区显示第二点 − 第一点与绝对差值。
- **签出只读副本**（`POST /api/trend/checkout`，仅 machinist）：把当前点集连同差值冻结为 `TrendSnapshot`。随后新判定/新投笔只刷新在线轨迹，既有副本保持不动；`#/snapshot/<id>` 打开的副本永远停在签出版（取一次、不轮询）。machinist 与 auditor 都可查看在线轨迹与已签出副本，auditor 签出返回 403。

| 接口 | 说明 |
|------|------|
| `GET /api/trend/points?limit=10` | 近次结清点（顺序同首页表） |
| `POST /api/trend/compare` | 后台算两点差值（body: `limit, first_id, second_id`） |
| `POST /api/trend/checkout` | 操作员签出冻结副本（可带两点 id） |
| `GET /api/trend/snapshots` / `…/{id}` | 已签出区列表 / 只读副本详情 |

## 验收

1. machinist 登录后，种子数据应显示刀具 T01 合格（刀补 5 µm）、T09 超差（刀补 20 µm）。
2. 提交一条新刀补后，状态先为「待复核」，数秒内 worker 处理为「已完成」并给出结论。
3. auditor 登录后只能看列表，没有提交表单。
4. 连线台近次点顺序与首页表一致；在线轨迹随新判定自动刷新，合格/超差点形与文字可辨。
5. 在点表挑两点后点「交后台算差值」，差值来自接口返回（前端无相减逻辑）。
6. machinist 签出后，已签出区出现副本；签出后再投新笔并等其结清，在线轨迹纳入新点，打开旧副本仍停在签出版。auditor 看不到签出按钮（接口 403），但可打开任意副本。

## 目录

```text
backend/          Django 工程（config/、desk/、worker.py）
frontend/         SolidJS 单页
docker-compose.yml
PRD.md
```
