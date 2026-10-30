# Pocket Paddock：迁移到可独立分享的托管

核查日期：**2026-10-29**。本目录已准备静态部署与服务器配置，**尚未开通云账号、购买域名、修改 DNS 或部署到新平台**。现有 `chatgpt.site` 的访问情况不代表下面方案已经上线。

当前可选路径：

| 路径 | 需要用户准备 | 可以确认的边界 |
| --- | --- | --- |
| 较快开始：EdgeOne Pages 境外节点 + 自有域名 | 腾讯云账号、一个可管理 DNS 的域名 | 官方支持不含大陆的节点及未备案域名；需要关闭 VPN 后实测大陆网络，不能保证每个运营商的访问质量 |
| 长期大陆节点：EdgeOne Pages 大陆 / 全球含大陆 + 自有域名 | 账号、域名、已完成 ICP 备案；办理条件以账号与备案控制台为准 | 使用大陆节点需备案；不能把一个临时默认域名当作长期公开网址 |
| 自己的香港服务器 | 云账号、香港服务器；域名和 HTTPS 可随后配置 | 腾讯云说明香港服务器不要求大陆 ICP 备案；跨境链路仍需实测。下面提供 Nginx / Docker 配置 |

推荐先完成第一条的**账号与域名**准备，再决定是否继续办理大陆节点。没有这些资源时，离线单文件可以供朋友本地试玩，但它不是公开网页链接。

## 先构建可上传的文件

在**项目根目录**运行：

```bash
npm ci
npm run build
python deployment/package-static.py
```

输出为 `dist/` 和 `outputs/Pocket-Paddock-Static-版本号.zip`。ZIP 最外层直接包含 `index.html`、`assets/`、`models/`，没有多套一层 `dist/`。本游戏的 JS、模型和生成材质随站点提供，运行时不需要第三方模型 CDN。

## EdgeOne Pages：直接上传

1. 用户登录 [腾讯云 Pages 控制台](https://console.cloud.tencent.com/edgeone/pages)，创建项目，选择直接上传。
2. 选择加速区域。尚无备案域名时使用“全球可用区（不含中国大陆）”；若要大陆节点，先完成相应备案条件。
3. 上传上述 ZIP 或 `dist` 文件夹。直接上传不会替你执行构建，因此不要上传 TypeScript 源码包。
4. 在项目的域名管理中添加自己的域名，按控制台完成所有权验证、CNAME 和 HTTPS 配置。示例可用 `play.你的域名`，不要填写不存在的示例域名。
5. 分享**自定义域名的 HTTPS 地址**，随后执行下文的大陆网络验证。

默认项目 / 部署域名存在限制：大陆 / 全球含大陆项目使用约 3 小时的预览链接；不含大陆项目的默认域名在大陆网络会返回 401。上述规则针对默认项目及部署域名，**并不是对所有自定义域名请求的一概封禁**。官方建议以自定义域名建立稳定入口；境外节点的大陆实际可达性仍须实测。[官方域名规则](https://edgeone.cloud.tencent.com/pages/document/175191784523485184)

直接上传项目不能直接改成 Git 集成项目；以后需要自动构建时另建 Git 项目。[官方直接上传指南](https://cloud.tencent.com/document/product/1552/127371)

## EdgeOne Pages：从最新 Git 源码构建

先确认仓库已经同步本次修改；本地最新版不会因之前上传过 GitHub 而自动出现在远端。

| 配置 | 值 |
| --- | --- |
| 项目根目录 | `./` |
| 安装命令 | `npm ci` |
| 构建命令 | `npm run build` |
| 输出目录 | `dist` |
| Node.js | `22.17.1`，或平台提供的满足项目要求的较新版本 |

本项目使用 Vite 7，不要选择旧的 Node 20.18 / 22.11。腾讯云构建文档列有 `22.17.1` 与 `24.5.0`。也可将本目录的 `edgeone.example.json` 复制为项目根目录的 `edgeone.json`，再提交到选择的分支。[官方构建指南](https://edgeone.cloud.tencent.com/pages/document/162936788693114880)、[配置字段](https://edgeone.cloud.tencent.com/pages/document/162936771610066944)

域名和加速区域仍需按上一节配置。账号登录、仓库授权、域名注册、费用确认和 DNS 验证由用户完成；不要把访问令牌写入仓库。

## 香港服务器：Docker / Nginx 备用路径

本目录 `Dockerfile` 从项目源码构建静态资源，Nginx 仅提供文件，不运行 Node 后端。安装好 Docker 后，在项目根目录执行：

```bash
docker build -f deployment/Dockerfile -t pocket-paddock-web .
docker run --detach --name pocket-paddock-web --publish 8080:8080 pocket-paddock-web
```

先在服务器本机验证 `http://127.0.0.1:8080/healthz` 返回 `ok`。需要外部试玩时，由用户在服务器防火墙 / 安全组开放实际使用端口，再用真实公网 IP 测试。正式域名建议通过托管证书或反向代理提供 HTTPS。本目录没有虚构公网 IP、证书或已开通服务器。

已构建的 `dist/` 也可交给现有 Nginx；调整 `nginx.conf` 中的根目录及端口即可。配置让哈希 JS/CSS 长期缓存、`index.html` 和未哈希的模型重新验证；缺失的模型返回 404，不回退成 HTML。[腾讯云香港 / 境外备案说明](https://cloud.tencent.com/document/product/243/19630/)

当前环境未安装 Docker 或 Nginx，**未运行容器或执行 `nginx -t`**。已核对配置结构与静态打包脚本；首次上服务器后要再做真实进程验证。

## CloudBase 为什么不是直接换一个默认域名就完成

CloudBase 可以上传静态文件或从 Git 构建，但官方把默认域名限定于开发测试，存在访问频率限制和访问提示中间页；生产环境同样建议自定义域名。不能把它的默认域名承诺为长期稳定的分享链接。[CloudBase 静态托管](https://cloud.tencent.com/document/product/876/46900)、[默认域名规则](https://docs.cloudbase.net/service/alias)

## 发布后验证与费用

- 关闭 VPN，分别用中国移动 / 联通 / 电信中的实际可用网络访问，最好同时测手机流量与家庭宽带；记录地区、网络、时间和结果。
- 检查首页、JS、两份 GLB 与配色表均成功加载；实际起步、驾驶、暂停、切换天气和语言，确认没有 401、403、404。
- 换域名后浏览器会采用独立的本地存储，旧域名最佳成绩不会自动迁移。换托管可改善可达性与下载，但驾驶 FPS 仍由设备与渲染负担决定。
- 免费档也存在构建、存储、文件等配额；域名或服务器可能另行计费。不要依据此文假设任何费用已获批准，实际价格及配额以开通控制台为准。[官方价格说明](https://pages.edgeone.ai/document/pricing-and-plans)、[官方限制与配额](https://edgeone.ai/zh/document/211893332490612736)

**证据边界：**平台部署能力、默认域名限制、节点与备案要求来自上方官方文档；境外自定义域名可能适合当前快速上线，是基于这些规则的方案选择，不是已经完成的中国大陆网络可达性测试。
