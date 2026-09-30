# 数控刀补复核台

操作员提交刀具编号与刀补微米值；后台 worker 用 PostgreSQL 行锁（`select_for_update(skip_locked=True)`）认领待复核记录，按绝对值是否不超过 12 微米给出「合格」或「超差」。

「在线连线台」把近次已结清的刀补按时间连成线：条数可选（近 5/10/20 次），点表按时间倒序与总览表同序，合格/超差点分别标注。挑两个点（甲、乙）交后台算差值，页面不自行相减。操作员可把当前点集连同差值「签出」为只读副本——副本冻住点集与差值，之后新提交、新判定只刷新在线轨迹，既有副本保持不动；操作员与复核员都能打开查看，仅操作员可签出。

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
| machinist | machine123456 | 可提交刀补、可签出副本 |
| auditor | audit123456 | 只读：看列表与全部签出副本，不能提交、不能签出 |

## 启动

```bash
cd projects/17-cnc-tool-offset-desk
docker compose up --build
```

健康检查：`GET http://localhost:8196/api/health` → `{"status":"ok"}`

## 验收

1. machinist 登录后，种子数据应显示刀具 T01 合格（刀补 5 µm）、T09 超差（刀补 20 µm）。
2. 提交一条新刀补后，状态先为「待复核」，数秒内 worker 处理为「已完成」并给出结论。
3. auditor 登录后只能看列表，没有提交表单。
4. 进入「在线连线台」：近 5/10/20 次切换条数；结清点按时间倒序排列，与首页「复核列表」顺序一致；曲线上圆点=合格、菱形=超差，并有 ±12µm 合格带。
5. 在点表挑甲、乙两个点，点「交后台算差值」：差值（乙−甲、绝对值与合格/超差）由接口 `POST /api/track/diff` 返回；切条数或重选会清空旧差值，页面不做本地相减。
6. machinist 点「签出只读副本」后跳到副本页：点集与差值被冻住；再投新笔并等 worker 判定，在线连线台出现新点，而重新打开该副本仍是签出时的版本。
7. 已签出区按时间倒序列出全部副本；auditor 可打开任意副本，但看不到签出按钮，直接调 `POST /api/checkouts` 返回 403。
8. 副本页不自动刷新；签出后再投新笔，副本仍停在签出版。

## 接口（新增）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/track/points?limit=10` | 近次结清点（时间倒序，与总览同序） |
| POST | `/api/track/diff` | 后台算两点差值（入参 `first_id`、`second_id`） |
| GET | `/api/checkouts` | 已签出副本列表（两类角色可看） |
| POST | `/api/checkouts` | 签出只读副本（仅 machinist，冻住 `limit` 个点与可选两点差值） |
| GET | `/api/checkouts/{id}` | 打开某个冻结副本 |

## 目录

```text
backend/          Django 工程（config/、desk/、worker.py）
frontend/         SolidJS 单页
docker-compose.yml
PRD.md
```
