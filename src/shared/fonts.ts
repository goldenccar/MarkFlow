import type { FontOption, FontFamily } from './types'

export const fontCatalog: { id: FontOption['id']; name: string; family: string; aliases: string[] }[] = [
  { id: 'system', name: '系统默认', family: 'system-ui, "Microsoft YaHei", sans-serif', aliases: [] },
  { id: 'fangsong', name: '仿宋', family: '"FangSong", "仿宋", serif', aliases: ['FangSong', '仿宋'] },
  { id: 'fangsong-gb2312', name: '仿宋_GB2312', family: '"FangSong_GB2312", "仿宋_GB2312", serif', aliases: ['FangSong_GB2312', '仿宋_GB2312'] },
  { id: 'kaiti', name: '楷体', family: '"KaiTi", "楷体", serif', aliases: ['KaiTi', '楷体'] },
  { id: 'kaiti-gb2312', name: '楷体_GB2312', family: '"KaiTi_GB2312", "楷体_GB2312", serif', aliases: ['KaiTi_GB2312', '楷体_GB2312'] },
  { id: 'microsoft-yahei', name: '微软雅黑', family: '"Microsoft YaHei", "微软雅黑", sans-serif', aliases: ['Microsoft YaHei', '微软雅黑'] },
  { id: 'alibaba-puhuiti', name: '阿里巴巴普惠体', family: '"Alibaba PuHuiTi 3.0", "Alibaba PuHuiTi 2.0", "Alibaba PuHuiTi", sans-serif', aliases: ['Alibaba PuHuiTi 3.0', 'Alibaba PuHuiTi 2.0', 'Alibaba PuHuiTi', '阿里巴巴普惠体', 'Alibaba PuHuiTi 3 55 Regular', '阿里巴巴普惠体 3 55 Regular'] },
]

export function fontFamilyCss(id: FontFamily | undefined): string { return fontCatalog.find(font => font.id === id)?.family ?? fontCatalog[0].family }
