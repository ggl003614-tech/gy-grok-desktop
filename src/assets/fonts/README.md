# 内嵌字体

界面字体不依赖用户机器上装了什么 —— 全部打包进应用。

| 文件 | 是什么 | 大小 |
|---|---|---|
| `inter-400/500/600/700.woff2` | Inter，只有拉丁字形，管英文和数字 | 各 ~24KB |
| `noto-sans-sc-subset.woff2` | Noto Sans SC 可变字体的子集，管汉字 | 1.07MB |
| `OFL.txt` | Noto 的 SIL OFL 1.1 授权，随分发一起带 | — |

## 为什么必须内嵌，不能只改字体栈

实测：这台机器装了 `Noto Sans SC`（族名正确，在
`%LOCALAPPDATA%\Microsoft\Windows\Fonts`），但 **Chromium / WebView2 枚举不到它** ——
因为那是用户级安装。用 CDP 的 `CSS.getPlatformFontsForNode` 逐个探过：

```
请求 Noto Sans SC          -> 实际 Microsoft YaHei
请求 Source Han Sans SC    -> 实际 Microsoft YaHei
请求 MiSans                -> 实际 Microsoft YaHei
请求 HarmonyOS Sans SC     -> 实际 Microsoft YaHei
```

全部落回微软雅黑。所以「把好字体排到字体栈前面」这条路是无效的，必须打包。

字体栈里雅黑排最后，只当兜底 —— 它字重过粗、字距不匀，是原来「字丑」的来源。

## CSS 里为什么叫 GY Sans SC 而不是 Noto Sans SC

故意避开原名。系统里若装着同名字体，浏览器会优先用系统那份，内嵌的就白搭了。

## 子集怎么切的

范围 = **GB2312 一级字库 3755 字**（最常用汉字）+ **界面源码里出现的全部汉字/全角标点**
+ ASCII + 常用符号，合计 3902 个字符。17.7MB → 1.07MB。

只切界面用字不行：聊天内容是任意中文，缺字会落回雅黑，同屏两种字体更难看。
GB2312 一级覆盖日常中文基本全部。

可变字重轴 `wght 100–900` 完整保留，所以一个文件够所有字重用，
`@font-face` 里写 `font-weight: 100 900` + `format("woff2-variations")`。

重新生成（源字体在 `C:\Windows\Fonts\NotoSansSC-VF.ttf`）：

```bash
# 1. 抠出界面用到的汉字
python - <<'PY'
import glob, io
chars = set()
for pat in ("src/**/*.ts", "src/**/*.tsx", "index.html"):
    for f in glob.glob(pat, recursive=True):
        for ch in io.open(f, encoding="utf-8").read():
            if "\u4e00" <= ch <= "\u9fff" or "\u3000" <= ch <= "\u303f" or "\uff00" <= ch <= "\uffef":
                chars.add(ch)
# 2. 并上 GB2312 一级字库
for hi in range(0xB0, 0xD8):
    for lo in range(0xA1, 0xFF):
        try:
            ch = bytes([hi, lo]).decode("gb2312")
            if "\u4e00" <= ch <= "\u9fff": chars.add(ch)
        except Exception: pass
chars |= set(chr(c) for c in range(0x20, 0x7f))
chars |= set("　、。，．：；！？（）【】《》「」『』—…·×÷±°％‰→←↑↓✓✗≈≠≤≥")
io.open("_subset_chars.txt", "w", encoding="utf-8").write("".join(sorted(chars)))
PY

# 3. 子集化
python -m fontTools.subset C:/Windows/Fonts/NotoSansSC-VF.ttf \
  --text-file=_subset_chars.txt \
  --output-file=src/assets/fonts/noto-sans-sc-subset.woff2 \
  --flavor=woff2 --layout-features='*' --no-hinting \
  --name-IDs='*' --drop-tables+=DSIG
rm _subset_chars.txt
```

**改了界面文案之后要重跑**，否则新加的生僻字会落回雅黑。

Inter 来自 `@fontsource/inter@5`（OFL），只取 latin 子集。
