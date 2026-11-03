"""把 capture.mjs 的高清截图和 wolfai-killer 自带美术整理进 public/assets/（被 git 忽略）。

用法（实验目录下）：
    python tools/prepare-assets.py ../../temp/wolf-cap ~/wolfai-killer
裁切框按 1920×1080 视口、deviceScaleFactor 2 的截图写死（坐标单位是 2x 像素）；界面改版后要重新量。
"""

import shutil
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
CAP = Path(sys.argv[1]).expanduser()
WK = Path(sys.argv[2]).expanduser()
OUT = ROOT / "public/assets"
OUT.mkdir(parents=True, exist_ok=True)

ROLES = ["WOLF", "VILLAGER", "SEER", "WITCH", "HUNTER", "FOX", "ANGEL", "SCAPEGOAT", "MASON", "SUPER_SAINT",
         "GUARD", "CUPID", "IDIOT", "ELDER", "WILD_CHILD", "CURSED", "BLESSED", "WOLF_KING", "WHITE_WOLF", "BEAUTY"]


def jpg(src: Path, name: str, box=None, width=None) -> None:
    im = Image.open(src).convert("RGB")
    if box:
        im = im.crop(box)
    if width and im.width > width:
        im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    im.save(OUT / name, quality=92)
    print(name, im.size)


# 美术：首页狼浮雕、站标、20 张身份图（800px 版本，界面用的就是这一套）
shutil.copy(WK / "frontend/public/hero-wolf.png", OUT / "hero-wolf.png")
shutil.copy(WK / "frontend/public/mark.png", OUT / "mark.png")
for code in ROLES:
    d = WK / "frontend/public/roles"
    src = next(iter([d / f"{code}.webp", *sorted(d.glob(f"{code}-hero-*.webp"))]), None)
    src = src if src.exists() else sorted(d.glob(f"{code}-hero-*.webp"))[0]
    jpg(src, f"role-{code}.jpg")

# 整屏（给 3D 屏幕当贴图）
jpg(CAP / "home-hero.png", "screen-home.jpg", width=2880)
jpg(CAP / "setup-picked.png", "screen-setup.jpg", width=2880)
jpg(CAP / "game/006.png", "screen-day.jpg", width=2880)
jpg(CAP / "game/010.png", "screen-vote.jpg", width=2880)
jpg(CAP / "detail-full.png", "screen-detail.jpg", width=2880)

# 从界面里“抠”出来浮在镜头前的组件
jpg(CAP / "setup-picked.png", "ui-casefile.jpg", box=(2610, 735, 3252, 1810))  # 开局页右侧“案卷概要”
jpg(CAP / "setup-picked.png", "ui-presets.jpg", box=(800, 1110, 2020, 1230))  # 预设一排
jpg(CAP / "game/012.png", "ui-verdict.jpg", box=(1340, 690, 2500, 1470))  # 民阵胜幕布
jpg(CAP / "game/010.png", "ui-voteweb.jpg", box=(1300, 520, 2540, 1840))  # 投票连线
jpg(CAP / "detail-full.png", "ui-roster.jpg", box=(2600, 1520, 3260, 2180))  # 卷宗“座次名册”
