// 站点身份和读者看得到的文案。换成你的行业时，先改这个文件。
// 网页和后端都读它；改完重新构建（docker compose up --build）即可生效。
// 域名不在这里：部署时用环境变量 SITE_URL 设置。

export const SITE = {
  /** 站名：导航、页面标题、分享图、RSS、MCP、后台都用它。 */
  name: "岩歌快讯",
  /**
   * 行业词：拼进默认说法里，比如“AI 日报”“AI 动态”。
   * 改成“法律”“HR”“黄金”之类，页面上就会变成“法律日报”“法律动态”。
   */
  subject: "加密市场",
  /** 首页的完整标题（浏览器标签、搜索结果）。 */
  homeTitle: "岩歌快讯｜加密市场重要进展",
  /** 一句话介绍：搜索引擎、分享卡片、RSS、llms.txt 会用。 */
  description: "关注 BTC、ETH、SOL 与成长型加密资产，追踪项目进展、代币机制和宏观政策，提供新闻摘要与原文入口。",
  /** 首页左上角和侧边栏下面的一行小字。 */
  tagline: "关注重要事实，跟踪研究变化",
  /** 界面语言（HTML lang、og:locale）。 */
  locale: "zh-CN",
  /** 默认域名，只在没设置 SITE_URL 时使用。 */
  defaultUrl: "http://localhost:3000",
  /**
   * MCP 工具名的前缀（小写字母、数字、下划线），工具会叫 yango_crypto_get_latest、yango_crypto_search……
   * 已经有人接入后就不要再改。
   */
  mcpPrefix: "yango_crypto",
  /** 对外联系邮箱（选填）：使用规则、llms.txt、响应头里会写。 */
  contactEmail: null as string | null,
  /** 页脚的一行小字（选填）。 */
  footerNote: "由 AIHOT 开源框架驱动",
  /** 中国大陆网站的 ICP 备案号（选填），填了就显示在页脚并链接到工信部备案系统。 */
  icp: null as string | null,
  /** 结构化数据里的网站运营者（搜索引擎用）。 */
  organization: {
    name: "岩歌快讯",
    /** 创始人（选填）：{ name, url, description }。 */
    founder: null as null | { name: string; url?: string; description?: string },
  },
  /** 抓取信源时报上的名字（User-Agent 里用），不要冒用别的站。 */
  crawlerName: "YangoResearchBot",
} as const;

/** 关于页的文案。数字（信源数、收录数、精选数、日报期数）来自站内实时统计，不用写在这里。 */
export const ABOUT = {
  kicker: `关于 ${SITE.name}`,
  /** 大标题：第一行正常颜色，第二行强调色。 */
  headline: ["加密市场每天都有新消息，", "值得看的，只有几条。"] as [string, string],
  /** 标题下面的一段话。{sources} 会换成实时的信源数。 */
  lead: `${SITE.name} 跟踪 {sources} 个信源，整理核心加密资产、项目业务、代币机制与宏观政策的公开进展，帮你找到值得继续研究的事实。`,
  /** 信源河动画下面的四个环节。 */
  steps: {
    collect: "跟踪项目公告、治理论坛、代码发布、加密媒体与宏观机构消息，按各信源的配置定期更新。",
    store: "保留来源与发布时间，将同一事件的多篇报道归并，方便追踪消息的来龙去脉。",
    select: "通过模型辅助筛选，优先展示与加密资产有关、信息明确的进展，减少重复报道与营销内容。",
    publish: "阅读摘要后，可沿原文核对数字、事件阶段和适用范围；也可以通过主题页继续追踪相关资产。",
  },
  /**
   * 作者块（选填），null 就不显示。
   * avatarSourceId：一个 X 账号信源的 id，头像取它的（选填）。
   * 二维码在后台“设置”里上传，或者放进 industry/brand/contact/；没有二维码就不显示那张卡片。
   */
  maker: null as null | {
    name: string;
    greeting: string[];
    avatarSourceId?: string | null;
    wechat?: { title: string; note: string };
    feishu?: { title: string; note: string };
  },
  /** 页面底部的版权与下架说明（结尾会接“反馈页”的链接）。 */
  copyright: `${SITE.name} 是聚合摘要和阅读索引，原文版权归各来源所有。如果你是来源方，希望更正、下架或调整展示方式，可以通过`,
} as const;

/** “AI 日报”这类说法：行业词和名词之间，英文词加空格，中文词不加。 */
export function withSubject(noun: string): string {
  return /[A-Za-z0-9]$/.test(SITE.subject) ? `${SITE.subject} ${noun}` : `${SITE.subject}${noun}`;
}
