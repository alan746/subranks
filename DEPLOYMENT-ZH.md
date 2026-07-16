# SubRanks 部署与测试指南

## 1. 使用的语言

这个项目的主要语言是 **TypeScript**。

- 前端：React + TypeScript，负责签到页面、进度条、排行榜和版主管理页面。
- 后端：Express + TypeScript，运行在 Devvit Web 服务器上。
- 数据库：Devvit Redis，保存经验、签到、连续签到和排行榜。
- Reddit 功能：Devvit Reddit API、评论触发器和 user flair。

浏览器最后运行的是 Vite 打包出来的 JavaScript，但开发时直接阅读和修改 TypeScript 即可。

## 2. 安装准备

在 Windows 上安装：

1. Node.js 22.2.0 或更高版本。
2. Visual Studio Code 或 IntelliJ IDEA。
3. 一个正常登录的 Reddit 账号。

检查 Node.js：

```powershell
node --version
npm --version
```

## 3. 创建属于你的 Devvit 应用

`devvit.json` 里的 `subranks-demo` 只是占位名称。Devvit 的应用名称必须在全平台唯一，而且必须属于你的开发者账号。

1. 打开 <https://developers.reddit.com/new>。
2. 登录 Reddit。
3. 创建一个新应用并选择 React/Devvit Web 模板。
4. 取一个3到16字符的唯一英文名称，例如 `alan-subranks`。
5. 打开本项目的 `devvit.json`。
6. 把：

```json
"name": "subranks-demo"
```

改成你刚才注册的准确名称。

这一步非常重要。只修改名字，不要删除 Redis、Reddit、menu 或 triggers 配置。

## 4. 安装依赖并运行自动测试

在 PowerShell 中进入项目文件夹：

```powershell
cd 你的路径\subranks-devvit
npm install
npm run check
```

`npm run check` 会依次完成：

1. TypeScript 类型检查。
2. XP、签到、连续签到、前三条评论、删除评论回滚等单元测试。
3. Devvit 生产版本打包。

全部成功时，最后会看到 `Build complete`。

## 5. 登录 Devvit 并启动 Playtest

```powershell
npx devvit login
npm run dev
```

命令会打开 Reddit 授权页面。授权后，如果你没有测试社区，Devvit 会自动创建一个很小的开发 subreddit，并自动让应用在那里运行。

终端会显示类似：

```text
Playtest ready
URL: https://www.reddit.com/r/xxxxx_dev/?playtest=xxxxx
```

点击这个 URL。

如果你已经创建了一个自己担任版主、成员少于200人的公开测试 subreddit，可以运行：

```powershell
npx devvit playtest r/你的测试社区名
```

## 6. 创建真正的互动帖子

进入测试 subreddit 后：

1. 打开 subreddit 的版主管理菜单或更多菜单。
2. 找到 **Create SubRanks post**。
3. 点击后，应用会创建一个标题类似 `🏅 SubRanks: check in and level up` 的帖子。
4. 打开帖子。
5. 点击 **Open my rank**。

如果看不到这个菜单，依次检查：

- 你是否使用 `npx devvit login` 登录了正确的账号。
- 这个账号是否是测试 subreddit 的版主。
- `npm run dev` 是否仍在运行。
- 终端是否显示上传或配置错误。

## 7. 版主设置头衔

在应用中点击 **Manage**：

1. 输入这套等级的名字。
2. 设置时区，例如多伦多使用 `America/Toronto`。
3. 设置连续第3天及以后的标准签到经验，默认5 XP；连续第1、2天默认获得3、4 XP。
4. 设置每条评论经验，默认2 XP。
5. 设置每天奖励几条评论，默认3条。
6. 设置2至18个等级，并编辑名称、经验门槛、说明和颜色。
7. 也可以先点击 Wizardry（10级）或 Software Engineering（8级）模板再修改。
8. 点击 **Publish rank system**。

只有服务器验证为当前 subreddit 版主的用户才能保存配置。普通用户即使手动请求接口也会收到403错误。

## 8. 测试签到和评论经验

按照下面的顺序测试：

1. 未加入 SubRanks 前发表评论，确认不会获得经验。
2. 点击 **Join community & claim first rank**，确认账号加入 subreddit，并立刻获得0 XP的最低级称号。
3. 第一天点击签到，确认获得3 XP；再点一次，确认不会重复获得经验。
4. 连续第二天确认获得4 XP，连续第三天及以后确认每天获得5 XP；断签后下一次重新获得3 XP。
5. 在该 subreddit 任意普通帖子下发表第一条有效评论，刷新 SubRanks，确认增加2 XP。
6. 继续发表第二、第三条评论，确认分别增加2 XP。
7. 发表第四条评论，确认不再获得经验。
6. 删除前三条中的一条，刷新应用，确认对应经验被扣除。
7. 查看排行榜，确认用户名、等级和经验正确。

评论事件由 Reddit 服务器发送，不要求用户必须先打开 SubRanks。应用安装以前的旧评论不会补发经验。

## 9. 测试 Reddit 头衔同步

这一功能默认关闭，因为它会覆盖用户在这个 subreddit 中原有的 flair。

1. 先在 subreddit 设置中启用 user flair。
2. 在 Manage 页面打开 **Sync rank to Reddit user flair**。
3. 保存设置。
4. 用户再次签到、获得评论经验或打开 SubRanks。
5. 检查用户名旁是否出现类似 `Contributor · Lv.3` 的 flair。

如果 XP 正常但 flair 没有变化，通常是 subreddit 没启用 flair，或应用没有足够的 moderator scope。

## 10. 发布前检查

```powershell
npm run check
npm run upload
```

发布未公开版本：

```powershell
npm run release
```

申请进入 App Directory，让其他 subreddit 的版主也能安装：

```powershell
npm run release:public
```

公开发布需要 Reddit 审核。不要删除英文 `README.md`，因为 Reddit 审核明确要求项目包含完整的 README。

## 11. 黑客松提交

最终准备两个链接：

1. Reddit Developer Dashboard 中的 App listing 链接。
2. 一个公开 subreddit 中实际运行 SubRanks 的互动帖子链接。

Demo 帖子最好直接使用一套有特色的头衔，例如修仙或数学主题，并把第2级门槛临时调低，让评委在短时间内能够看到升级效果。

## 12. 当前设计边界

- 不调用 AI API，头衔由版主亲自设计。
- 不检测或奖励 Reddit 点赞，因为 Devvit 没有提供每个用户的点赞触发器。
- 不读取或保存评论正文，只保存获得经验的评论 ID。
- 每个 subreddit 的数据相互独立。
- 删除个人数据会清除 XP、签到、连续签到和排行榜记录。
