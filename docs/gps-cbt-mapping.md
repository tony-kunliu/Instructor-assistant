# GPS 与 CBT&A 对照表（设计文档）

> 依据：ACT 纸质表 **Competency Based Training and Assessment Lesson Checklist，表格 10,044，
> 7/2002 版**（原件见 `~/workspace/goals/instructor-assistant-repository-work/files/ADI_CBT_A_CHECKLIST.pdf`）。
> 本文档按这张表的列来写，不再按推测的字段来。
>
> 原则：GPS 录什么，以这张表需要记什么为准。GPS 只提供“观察建议”，永远不直接判定
> Taught / Assessed / Achieved；每一项建议都要能追溯到具体的 GPS 观察（时间点、路口/地点、
> 数值），不要只给一个总数。原始逐点轨迹只存本机 IndexedDB，永不上传、不进 D1；进课程的
> 只有摘要数字和清单。
>
> 导出一致性（已核对）：应用的 checklist PDF 导出（`lib/pdf-export.ts` + `lib/pdf-layout.ts`）
> 是叠加在真实模板 `public/pdf-template/adi-cbta-checklist.pdf`（即 10,044 表）之上的，列的
> 顺序和表头与纸质表 1:1 一致，无出入。GPS 写进 Location / Comments 的内容走同一条导出路径。

## 一、表头字段（每页一次，全部手动）

| 表头字段 | 来源 | 说明 |
|---------|------|------|
| ADI name、ADI number、Student name、Page __ of __ | 手动（学员档案） | GPS 给不了 |
| Address、Phone、DOB、Licence number | 手动（学员档案） | GPS 给不了 |
| Expiry date、Eligibility、Manual / Auto、School / Work | 手动（学员档案） | GPS 给不了 |

## 二、每课一行的各列对照

每课占 4 个子行。**来源**分四种：GPS 自动（系统直接填）、手动（教练/学员填）、
GPS 建议 + 确认（GPS 出清单，教练勾选后才写入）、推导（由别的字段算出，不用手填）。

| 列（纸质表） | 子项 | 来源 | 数据定义 | 边界 |
|---|---|---|---|---|
| Date and lesson no. | Date（日期） | GPS 自动 + 时钟 | 课程开始的日期（堪培拉时间）；GPS 会话开始日期可交叉核对 | 以课程草稿的时钟为准，GPS 只核对 |
| | Lesson no.（课号） | 推导 | 按保存顺序递增，永不手填 | — |
| Time & total hrs | Start（开始） | GPS 自动 + 时钟 | 点 Start Lesson 的时间；GPS 会话开始时间可交叉核对 | 以草稿时钟为准 |
| | Finish（结束） | GPS 自动 + 时钟 | 点 End Lesson 的时间；GPS 会话结束时间可交叉核对 | 以草稿时钟为准 |
| | Total hrs（总时长） | 推导 | Finish − Start | 永远算出来，不手填 |
| Odometer & total kms | Start（起始里程表） | 手动 | 教练读码表输入 | **GPS 给不了里程表读数** |
| | Finish（结束里程表） | 手动 | 教练读码表输入 | **GPS 给不了里程表读数** |
| | Total kms（总公里数） | 推导 | Finish − Start（码表差值），是正式里程 | GPS 里程（诊断数）**不进**这一格，见下 |
| Taught（教了哪些） | 能力项编号 | GPS 建议 + 确认 | GPS 出建议清单（§三），教练勾选后写入 | GPS 只建议，不决定进哪一列 |
| Competencies Assessed（考了哪些） | 能力项编号 | GPS 建议 + 确认 | 同上 | 同上 |
| Achieved（通过了哪些） | 能力项编号 | GPS 建议 + 确认 | 同上；**GPS 绝不自动判 Achieved** | 通过是教练的判断，系统不替他做 |
| Location（地点） | 地点 | GPS 自动（可改） | 走过的路线摘要：按时间顺序列出经过的有名路口/街道（§四） | 只给街道名，不给郊区名；只覆盖 ACT；教练可改、教练手填优先 |
| Comments（备注） | 备注 | GPS 自动（可改） | GPS 观察摘要，一两句人能读的话（§四）；教练自己的备注保留在前 | 只有摘要行进 PDF；带时间+路口名的证据清单只留屏上复核用，不进 PDF |
| ADI & learner signatures | ADI Signature、Learner Signature | 手动 | 教练和学员在应用里签名，或纸质原件签名 | GPS 给不了 |

**GPS 里程的定位（重要）：** GPS 算出的里程是**诊断数**，只出现在 Comments 摘要行里
（"12.4 km"），供教练对照码表；正式的 Total kms 永远是码表差值。评审面板上也有一行
"GPS distance is an estimate; the odometer is the official record."（GPS 距离仅供参考，
正式里程以里程表为准），点开课程就能看到。

## 三、Taught / Assessed / Achieved：GPS 建议清单

建议清单由 `lib/gps/competency-suggestions.ts#gpsCompetencySuggestions` 生成，是纯数据
（下一步的勾选 UI 直接用它）。每条建议 = 一个能力项编号 + 官方标题 + 若干条证据；
证据每条都有时间点和数值，最多列 3 条具体的，多的只补一行总数。**没有证据的能力项不
出现在清单里；清单本身不写进任何一列，教练勾选后才写入。**

### GPS 能建议的（11 项）

| 能力项 | 证据（GPS 观察） | 置信度 |
|---|---|---|
| 4 Moving Off Procedure 起步 | 每次停车后起步：时间 + 停车时长（例 "10:24 moved off after a 45 s stop"） | 中 |
| 7 Turns, Left and Right 转弯 | 每次转弯：时间 + 方向 + 角度（例 "10:24 left turn (87°)"） | 高 |
| 8 Speed Control 速度控制 | 最高速、平均移动速度（只给数字） | 高（数值本身） |
| 9 Slowing Procedure 减速 | 每次停车前的减速：时间 + 最大减速度（例 "10:24 slowed to a stop (max 2.7 m/s², smooth approach)"） | 中 |
| 10 Stopping Procedure 停车 | 每次停车：时间 + 时长 | 高 |
| 12 Give Way Rules 让行 | 在路口前后 15 秒内有停车（例 "10:31 stopped before the roundabout — Coulter Drive"） | 中 |
| 13 Reversing 倒车 | 每次倒车：时间 + 距离 + 时长（低速 + 航向反转，且倒车前有停车） | 中 |
| 16 U-Turns 掉头 | 每次移动中掉头：时间点 | 高 |
| 17 Turning Around on the Road (Three Point Turn) 三点掉头 | 前进—停车—倒车—停车—前进的序列：时间 + 总时长 | 中 |
| 18 Lane Changing, Merging & Form One Lane 变道 | 横向位移 ≥ 3.5 米且持续、航向恢复后仍保持偏移（只报 "possible"，低置信度） | 低 |
| 20 Observation Skills, Visual Searching and Scanning, Hazard Recognition 观察 / 危险识别 | 实际经过的路口：时间 + 环岛/信号灯 + 路名（是"经过"，不是"观察到了"） | 中 |

### GPS 不能建议的（11 项 + 复习 + Final Drive，留给手动）

| 能力项 | 原因 | 手动补充方式 |
|---|---|---|
| 1 Vehicle Controls 车辆控制 | 车内操作无 GPS 信号 | 教练现场看，手动勾选 |
| 2 Cabin Drill 舱内检查 | 座椅、安全带、后视镜调整无信号 | 同上 |
| 3 Starting Up Procedure 启动程序 | 点火、挡位、手刹、观察等步骤不可见；只能证明"车动了" | 同上 |
| 5 Gear Changing / Clutch Operation 换挡 / 离合 | 无 OBD / 音频信号 | 同上 |
| 6 Steering Control & Vehicle Positioning 转向控制与车位 | 无车道级地图，车道保持不可靠 | 教练判断 |
| 11 Hill Starts 坡起 | 手机 GPS 高程误差大，无法确认是坡道；是否溜车无法确认 | 教练手动确认 |
| 14 Right Angle Parking (Front In) 直角停车 | 无停车场地图，是否停进车位不可确认 | 教练现场看 |
| 15 Reverse Parallel Parking 平行停车 | 是否贴边、与前后车距离不可确认 | 教练现场看 |
| 19 Overtaking 超车 | 是否真的超过一辆车（无他车数据）无法确认 | 教练现场看 |
| 21 Compliance with the System of Vehicle Control 系统化控车 | 镜—信号—操作顺序本身不可见；是综合判断 | 教练综合判断 |
| 22 Vulnerable Road Users 弱势道路使用者 | 需学校区域 / 斑马线地图数据（当前路口文件无）；行人本身不可见 | 教练现场看；后续可补 OSM 学校区域数据 |
| Review 1-17、Review 1-22 | 跨课程里程碑，教练根据多课表现判定 | 教练判定 |
| 23 Final Drive 忙碌 / 陌生道路驾驶 | 是否"忙碌 / 陌生"需教练结合路线判断；路线检查（R10）已有独立的城镇中心 + 勾选项流程 | 教练判定；GPS 的路口/转弯计数可作参考（例路线项要求 2+ 信号灯、5 左+5 右转弯，GPS 恰好能数这两项） |

**小结：GPS 能建议 11 项；不能建议 11 项 + 2 个 Review + Final Drive 23。不能的全部留
给教练手动，系统不猜。**

## 四、Location 与 Comments：GPS 自动填什么

### Location（路线摘要）

- 来源：`lib/gps/lesson-gps-notes.ts#lessonGpsRoute`，取实际经过的有名路口，按时间顺序、
  去重、用全名列出（例 "Coulter Drive / Redfern Street / Springvale Drive"），长度不超过
  Location 格上限 200 字（超了就只列前面的全名，不截半个名字）。
- 填入规则：Location 为空时自动填入 GPS 路线；教练手填的文字（包括 R10 路线检查写入的
  城镇中心前缀，如 "Woden: …"）优先，GPS 不覆盖；教练一旦改动 Location，GPS 不再重复
  建议（`locationEdited`）。
- 边界：只有街道名，没有郊区名（GPS 没有郊区数据）；只覆盖 ACT（路口文件
  `public/openstreetmap/act-junctions-2026-11-01.json`，1055 个路口）；没有经过有名路口
  的课，Location 留空，教练手填。

### Comments（GPS 观察摘要）

- 来源：`lib/gps/lesson-gps-notes.ts#lessonGpsNotes`，一行摘要 + 一份按时间排序的证据清单。
- 摘要行（一两句人能读的话，进 PDF 的 Comments 格）：GPS 估计（覆盖率 %）· 里程 km ·
  移动分钟 · 左转 ×N · 右转 ×N · [掉头 ×N] · 停车 ×N · [停车总分钟] · [倒车 ×N（M 米）] ·
  [三点掉头 ×N] · [可能变道 ×N] · 可能环岛 ×N · 可能信号灯路口 ×N · [信号灯附近等待 ≈M 分钟] ·
  [最高速 km/h] · [平均移动速度 km/h] · [白天/黄昏/夜晚分钟]。例："GPS estimates (100%
  coverage) · 12.4 km · 45 min moving · 6 left turns · 4 right turns · 2 stops · 2 possible
  roundabout passes · 3 possible signalised junctions · max 62 km/h · avg 41 km/h moving"。
- 证据清单（只留屏上复核用，**不进 PDF**）：每一条都有堪培拉时间 + 数值/路口名，例
  "10:24 Left turn (87°)"、"10:31 Roundabout — Coulter Drive"、"10:40 Reversed 10 m (6 s)"、
  "10:45 Stopped 45 s · smooth approach · moved off 10:46"。教练点开 "Review GPS observations"
  就能逐条核对。
- 教练的备注永远在前，GPS 行追加在后；教练改动 Comments 后，GPS 不再重复追加
  （`commentsEdited`）；Comments 写满时 GPS 行不挤占教练的文字。

### 什么不写进表里

- 速度只呈现数字（最高速、平均移动速度），**不判定超速**（路口文件无限速数据）。
- 红灯等待只报"在有灯路口附近停留时长"，**绝不声称闯红灯或等红灯**。
- 原始逐点轨迹、设备会话号、GPS 坐标：永不进表、不进 D1、不上传。

## 五、实现位置

- `lib/gps/turns.ts` — 左右转、移动中掉头（7、16；掉头时间一并返回，供建议追溯）
- `lib/gps/manoeuvres.ts` — 倒车段、三点掉头、横向位移（可能的变道）、停车 / 起步、减速过程（4、9、10、13、17、18）
- `lib/gps/lesson-environments.ts` — 环岛 / 信号灯路口清单、信号灯附近等待、昼夜（12、20 的路口部分）
- `lib/gps/summary.ts` — 里程（诊断数）、时长、最高速、平均速度、覆盖率（8、课程级数据）
- `lib/gps/lesson-gps-notes.ts` — 摘要行 + 证据清单（Comments）+ 路线摘要（Location）
- `lib/gps/competency-suggestions.ts` — Taught / Assessed / Achieved 建议清单（纯数据，勾选 UI 下一步用）
- `lib/gps/lesson-gps-draft.ts` — `lessonCommentsWithGps` / `lessonLocationWithGps`（保存时合成进表）
- `app/driver-app.tsx` — 评审面板（GPS 摘要 + 证据清单 + 路线提示 + "GPS 距离仅供参考，码表为准"）
- `lib/pdf-export.ts` + `lib/pdf-layout.ts` — 导出叠加在真实 10,044 模板上，列与纸质表一致（已核对，无出入）
