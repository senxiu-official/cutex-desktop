export const zhCN = {
  "world-clock.title": "世界时钟",
  "world-clock.description": "桌面上的几个城市的时间，像桌面时钟一样不带卡片（缺省堪培拉和重庆）；悬停可看和本地差几天、几小时",
  "world-clock.widget": "世界时钟",
  "world-clock.widgetHint": "几个城市的当前时间，和本地差几天、几小时",
  "world-clock.cities": "城市",
  "world-clock.citiesHint": "名字可以随意写；时区决定时间",
  "world-clock.city": "名字",
  "world-clock.zone": "时区",
  "world-clock.addCity": "添加城市",
  "world-clock.hour12": "12 小时制",
  "world-clock.showDiff": "在下面再写一行和本地的差别（悬停也能看到）",
  "world-clock.icon": "图标",
  "world-clock.iconNone": "无",
  "world-clock.iconPin": "定位针",
  "world-clock.iconHome": "家",
  "world-clock.showDate": "显示日期和星期",
  "world-clock.today": "今天",
  "world-clock.tomorrow": "明天",
  "world-clock.yesterday": "昨天",
  "world-clock.same": "和本地相同",
  "world-clock.ahead": "快 {h} 小时",
  "world-clock.behind": "慢 {h} 小时",
  "world-clock.cityA": "堪培拉",
  "world-clock.cityB": "重庆",
};
declare module "../i18nCatalog" {
  interface ModuleMessages extends Messages {}
}
type Messages = typeof zhCN;

declare module "../i18nCatalog" {
  interface ModuleZhHantMessages extends Record<keyof typeof zhCN, string> {}
}
