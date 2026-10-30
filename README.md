# Pocket Paddock · 口袋围场

**0.12 · 蒙扎与斯帕双赛道**。Three.js + TypeScript + Vite 制作的 Q 版方程式赛车游戏，提供单人计时、三圈人机竞速、11 支车队与 22 位车手、晴天 / 雨天、中英文、键盘与标准映射手柄。

赛车、头盔和依赖均随项目提供。运行时不访问外部模型库、音频库或字体 CDN。线上 3D 渲染仍由访问者电脑完成，帧率取决于显卡、驱动、硬件加速、分辨率和画质；更换托管平台主要影响加载与访问，不会让云端替电脑渲染。

## 启动

建议使用 Node.js 22 LTS，桌面版 Chrome / Edge 并开启硬件加速。

```sh
npm ci
npm run dev
```

打开终端显示的地址。生产构建：

```sh
npm test
npm run build
npm run preview
```

`npm run build:offline` 会生成 `outputs/Pocket-Paddock-Offline-0.12.0.html`。交付的离线 HTML 已内嵌脚本、样式和模型，用 Chrome / Edge 直接打开即可，无需 Node.js、服务器、网络或 VPN。不要在压缩包、微信文件预览中运行。离线版不保证每台设备相同帧率，建议先选“自动”。

`file://` 成绩和设置受浏览器、文件位置、清理数据与存储权限影响；离线版和网站记录不共享。无可用存储时仍可玩。

线上试玩：[Pocket Paddock](https://pocket-paddock-monza.leowang8431.chatgpt.site/)。当前不保证中国大陆无需 VPN 稳定直连；公网迁移按用户选择暂缓。`deployment/` 仅提供部署准备文件。

## 本版内容

- 菜单可选择 **蒙扎 / 斯帕**，沿用全车队、天气、语言、视角和比赛模式。换赛道会重载场景，限围场操作。
- 蒙扎保留原布局与操控、Roggia / Lesmo 2 局部缩窄 5%；看台从 7 座扩至 **21 座、6,184 位观众**。原七座位置和朝向保持，新增十四座检查道路、维修区、屋顶互避，迁移冲突树木。
- 斯帕是独立完整赛道，参考 7,004 米布局缩至 **4,202.4 游戏单位**；Eau Rouge / Raidillon 包含实际可驾驶爬坡，其他段落也有起伏。坡度影响加速，赛车、AI、镜头、路肩、雨天效果随地面高度变化。
- 斯帕特色看台参考官方实景：40 排、4,600 个座位位置、灰色大顶棚、下层玻璃接待区、外部折返楼梯。全场 **21 座看台、9,766 位观众、1,800 株混合树林**。其余二十座为游戏设施，数量、位置不是官方看台清单。
- 两条赛道均保留 11 队完整策略室、68 位简化工作人员、维修区细节与 **RIOLEX** 时钟。斯帕使用自己的 GP 楼体，未照搬蒙扎双塔与 Fans Club。
- 成绩按 **赛道 × 晴雨** 分四个榜。蒙扎旧存储键保持兼容；竞速模式不写计时榜。
- 引擎继续使用 0.11 的 CC0 实录机械周期波形；移除随机噪声和空气层，升档断油、降档补油及起步负载共用八档转速状态。

## 操作

| 操作 | 键盘 | Xbox / PlayStation 标准映射 |
| --- | --- | --- |
| 油门 / 制动与倒车 | W / ↑、S / ↓ | RT / R2、LT / L2 |
| 转向 | A D / ← → | 左摇杆 |
| 回到赛道 | R | Y / △ |
| DRS | F | X / □ |
| 近距 / 标准 / 远距镜头 | C | R3 |
| 暂停 / 继续 | Esc | Menu / Options |
| 开始 / 再比一场 | Enter 或按钮 | A / × |
| 返回围场 | 页面按钮 | B / ○ |

手柄连接后按一次按键让浏览器识别。支持 `standard` 映射，摇杆 / 扳机保留模拟输入；断开会暂停，重新连接须松开功能键再按。已有模拟 Gamepad API 检查，尚未使用实物手柄逐型号测试。

操作建议：直线先制动、入弯渐松刹、回正后加速。雨天抓地更低、制动距离更长。驶入草地或砂石会减速；持续超出赛道使本圈无效。计圈必须正向按顺序经过检查点，重置使本圈无效。

## 比赛与 DRS

计时挑战包含五灯倒计时、速度 / 档位 / RPM、当前圈与最佳圈、检查点及本地存储。人机竞速共 6 辆车、3 圈，玩家 P3 发车，AI 会按弯道曲率制动、换线和接触避让。玩家与 AI 使用同一套完整优化 GLB，单车约 **27,540 三角形**，对手通过共享几何和实例绘制降低开销。

这是街机比赛，尚无排位赛、轮胎磨损、损伤、进站策略、正式旗语与罚时。AI 不采用橡皮筋追赶，也暂不主动使用 DRS。

DRS 参考 **FIA 2025** 地图，作为经典手动玩法保留，不宣称复刻 2026 规则。晴天在指定直道正向行驶、非维修道、达到最低速度后手动开启；刹车、离开路面、碰撞、倒车或驶出区域自动关闭。雨天禁用，每个区域须重新开启；没有前车一秒差规则。

| 赛道 | 检测 / 激活真实参考 | 游戏映射 |
| --- | --- | --- |
| 蒙扎 1 | T7 前 95m / T7 后 170m | Lesmo 2 出口至 Ascari 前 |
| 蒙扎 2 | T11 后 20m / 终点后 12m | 主直道至第一减速弯前 |
| 斯帕 1 | T2 前 240m / T4 后 305m | Kemmel 至 Les Combes 前 |
| 斯帕 2 | T18 前 160m / T19 后 30m | GP 主直道至 La Source 前 |

真实米数按各赛道长度比例缩放；弯道出口采用游戏中心线锚点、关闭点为游戏制动区。斯帕 T19 出口使用 Bus Stop 锚点后约 55 米的艺术化定位，不是测绘坐标。

## 真实参考与艺术化处理

### 蒙扎

主要参考：[官方看台地图](https://www.monzanet.it/wp-content/uploads/2023/09/MAPPA_CIRCUITO_2023_tribune.pdf)、[官方 GP 2026 Hospitality 手册](https://www.monzanet.it/wp-content/uploads/2025/11/Brochure_Hospitality_GPf12026.pdf)、[FIA 2025 意大利站赛道图](https://www.fia.com/system/files/decision-document/2025_italian_grand_prix_-_event_notes_-_circuit_map_pit_lane_emergency_exit_map_quarantine_zone_and_red_zones.pdf)。保留 P 房与看台分列主直道两侧、维修通道与围场设施的大体关系，区分独立 TOWER 和弧形 Fans Club。

楼体 / 看台体量、车库数量、距离、装饰和新增看台经过压缩与重新布置。Monza House、Ultimate Hospitality 参考上述官方手册；Cascina Costa Alta 与 Serraglio 门楼参考 [Reggia di Monza 官方建筑资料](https://reggiadimonza.it/architetture/)。它们提供公园背景识别度，不代表真实赛车视野中必定可见或逐座测绘。

树林参考[官方自然资料](https://reggiadimonza.it/natura/)，用多种宽冠 / 柱冠等轮廓表现公园。护栏外吊车、救护车与砂石区轮胎墙是静态装饰；具体车型、数量和停放点为艺术化设计。

### 斯帕

平面布局来自 [Tomislav Bacinger 的 f1-circuits](https://github.com/bacinger/f1-circuits/blob/master/circuits/be-1925.geojson)，MIT 许可见 `THIRD_PARTY_NOTICES.txt`；高程参考[赛车场官方场地资料](https://www.spa-francorchamps.be/sites/default/files/pdf/en/SF_access-organiser.pdf)，在公开高度站点之间插值。

Raidillon 看台参考[官方 2022 新设施介绍](https://www.spa-francorchamps.be/en/news/262_inauguration-of-the-new-infrastructure-of-the-circuit-of-spa-francorchamps)及[官方场地租赁图册](https://www.spa-francorchamps.be/en/evenement-locationdesalles)。DRS 参考 [FIA 2025 比利时站赛道图](https://www.fia.com/system/files/decision-document/2025_belgian_grand_prix_-_event_notes_-_circuit_map_pit_lane_emergency_exits_quarantine_zone_and_red_zones.pdf)。

道路 / 高度共享同一模型；地形、护栏、维修通道和建筑均简化。La Source 和 Bus Stop 为适应既有玩具赛车转向半径进行了局部圆滑，保留可识别的发夹 / 双弯结构及整圈长度比例。维修通道入口绕开 Bus Stop，主体保持水平。

**没有建筑 CAD 或现场测量，不能称作精确 1:1 复刻。** 看台轮廓、座位容量和接待层按照片研究，几何尺寸、其他看台分布与森林位置属于微缩场景设计。

### 赛车、策略室与音频

赛车与头盔来自用户提供的 GLB / OBJ / MTL 及 CSV，做了合并、材质与运行时模型优化。车手年份、名单和模型配色沿用资产资料，不将未经核实的纹样标作真实官方头盔复刻。用户资产的原始授权没有单独附带，项目不代替原权利人授予新许可。

策略组工作位参考 [McLaren 官方 pit wall 介绍](https://www.mclaren.com/racing/formula-1/2026/who-sits-on-mclarens-pit-wall/)及 [F1 官方指南](https://www.formula1.com/en/latest/article/the-insiders-guide-to-the-pit-wall.CFwHwjTcLNO5Gf4B3Dy4o)。每队一室、四位工程师 / 八屏、独立队色标识；十二组车库另有屏幕、键盘、工具、轮胎车、悬臂和管线。68 位策略 / 维修人员只保留躯干、队色头盔与深色面罩，工程师保留耳麦。屏幕图形是装饰数据。

实际解码并分析了 [F1 官方 Norris 2024 蒙扎杆位圈](https://www.formula1.com/en/video/onboard-lando-norris-2024-pirelli-pole-position-award-lap-at-the-italian-grand-prix.1808919989852209304)的 106.25 秒音轨，研究机械谐波与换档变化；官方视频未打包。可分发声源来自 [lmnmrn 的 motor.wav / F1 Engine Ignition](https://freesound.org/people/lmnmrn/sounds/197219/)，CC0，未核实原车型 / 年份。对录音平均相位对齐周期形成两组自定义 Web Audio 波形，非直接播放官方车载音轨，也非特定车型的精确仿真。`scripts/prepare-engine-cycles.py` 可复现提取，正常构建无需 Python 或音频下载。声音默认关闭，需点击按钮开启。

## 代码入口

| 模块 | 作用 |
| --- | --- |
| `src/main.ts` | 场景、固定步长游戏循环、状态与 UI 连接 |
| `src/track.ts`、`spa-track.ts` | 道路查询、表面、检查点、斯帕几何 / 高程 |
| `src/scenery.ts`、`spa-scenery.ts` | 两条赛道建筑、树林、看台与实例绘制 |
| `src/pit-complex.ts` | P 房、策略室、工作人员、RIOLEX 钟 |
| `src/physics.ts`、`handling.ts` | 油门、渐进制动、转向、抓地与碰撞 |
| `src/fleet-car.ts`、`team-catalog.ts` | GLB 加载、队色 / 头盔、车型细节 |
| `src/ai-race.ts`、`ai-rivals.ts` | AI 路径、比赛状态、共享赛车实例 |
| `src/race.ts`、`competition.ts` | 顺序计圈、排名、成绩隔离 |
| `src/camera.ts`、`road-pose.ts` | 展车镜头、三档跟车、坡度姿态 |
| `src/powertrain.ts`、`audio.ts`、`engine-cycles.ts` | 八档 RPM、换档与无空气层声源 |
| `src/drs.ts`、`drs-markers.ts`、`drs-wing.ts` | DRS 区域、标牌和活动后翼 |
| `src/ui.ts`、`i18n.ts`、`circuits.ts` | 选车、赛道、双语、存储键 |
| `src/weather.ts`、`quality.ts` | 晴雨、分辨率预算与自动画质 |

## 验证与后续

`npm test` 当前包含 **160 项检查**，覆盖实际模型、计圈防作弊、物理、AI、DRS、音频参数、四榜隔离、看台 / 建筑 / 树林净空及真实地形高度。斯帕新增数字输入驱动真实 Vehicle + RaceSession：晴天三个有效圈、雨天一个有效圈；不写入车辆位置、速度或检查点。几何检查另包含全圈 4,800 次地形与路面探测。

浏览器脚本：`test:competition` 为实际键盘事件三圈比赛；`test:presentation` 检查三种屏幕尺寸完整赛车展示；`test:audio` 在 OfflineAudioContext 检查实录周期声源、换档和静音；`test:offline` 检查本地文件启动。浏览器场景调试检查运行 Vite DEV，生产包不暴露 `window.__PP`。

同一台电脑上的自动测试不能替代其他显卡 / 浏览器、实物手柄或扬声器试听。下一步优先补不同设备性能、AI 难度 / 走线、进站策略和更精细场景，而后再做公网免 VPN 迁移。
