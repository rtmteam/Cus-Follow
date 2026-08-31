#!/usr/bin/env python3
"""
يولّد أيقونات التطبيق وشاشات البداية من صورة واحدة.

المصدر : resources/icon.png   (يُفضّل 1024×1024، مربّعة، بلا هوامش)
الهدف  : android/app/src/main/res/...

يُشغَّل بعد npx cap add android ليستبدل أيقونة Capacitor الافتراضية.
"""

import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw
except ImportError:
    print("[خطأ] مكتبة Pillow غير مثبّتة. ثبّتها بـ: pip install pillow")
    sys.exit(1)

SOURCE = Path(sys.argv[1] if len(sys.argv) > 1 else "resources/icon.png")
RES = Path(sys.argv[2] if len(sys.argv) > 2 else "android/app/src/main/res")

# نسبة الشعار داخل لوحة الأيقونة التكيّفية.
# أندرويد يقصّ اللوحة إلى 72dp من أصل 108dp، أي 66% تقريباً،
# فأي محتوى خارج هذه النسبة سيُقتطع على بعض الأجهزة.
FOREGROUND_RATIO = 0.66

# مقاسات الأيقونات كما يولّدها Capacitor بالضبط
LAUNCHER_SIZES = {
    "mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192,
}
FOREGROUND_SIZES = {
    "mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432,
}
SPLASH_PORT = {
    "mdpi": (320, 480), "hdpi": (480, 800), "xhdpi": (720, 1280),
    "xxhdpi": (960, 1600), "xxxhdpi": (1280, 1920),
}
SPLASH_LAND = {
    "mdpi": (480, 320), "hdpi": (800, 480), "xhdpi": (1280, 720),
    "xxhdpi": (1600, 960), "xxxhdpi": (1920, 1280),
}


# لون احتياطي عند تعذّر استخراج لون من الصورة (نفس backgroundColor في إعدادات التطبيق)
FALLBACK_BG = (0x0F, 0x17, 0x2A)


def trim_transparent(img):
    """
    يقصّ الهوامش الشفافة المحيطة بالمحتوى.

    كثير من الصور المصمّمة تأتي بهامش شفاف حول الشكل، ولو تُركت كما هي
    فسيضيف أندرويد قصّه الخاص فوق الهامش، فتظهر أيقونة صغيرة داخل مساحة فارغة.
    """
    if img.mode != "RGBA":
        return img
    bbox = img.split()[-1].getbbox()
    if not bbox:
        return img
    w, h = img.size
    trimmed_w, trimmed_h = bbox[2] - bbox[0], bbox[3] - bbox[1]
    # لا نقصّ إلا إذا كان الهامش ملموساً
    if trimmed_w >= w * 0.97 and trimmed_h >= h * 0.97:
        return img
    print(f"  قُصّ هامش شفاف: {w}×{h} ← {trimmed_w}×{trimmed_h}")
    return img.crop(bbox)


def dominant_color(img):
    """
    اللون الغالب على حواف المحتوى المرئي - يُستخدم كخلفية للأيقونة التكيّفية وشاشة البداية.
    البكسلات الشفافة تُتجاهل، وإلا خرج اللون أسود دائماً مع الصور ذات الخلفية الشفافة.
    """
    rgba = img.convert("RGBA")
    w, h = rgba.size
    step = max(1, w // 60)

    coords = []
    for x in range(0, w, step):
        coords.append((x, 0))
        coords.append((x, h - 1))
    for y in range(0, h, step):
        coords.append((0, y))
        coords.append((w - 1, y))

    opaque = [p for p in (rgba.getpixel(c) for c in coords) if p[3] > 200]

    # الحواف كلها شفافة: نأخذ اللون الوسيط من المحتوى المرئي كله
    if not opaque:
        small = rgba.resize((48, 48), Image.LANCZOS)
        opaque = [small.getpixel((x, y))
                  for x in range(48) for y in range(48)
                  if small.getpixel((x, y))[3] > 200]

    if not opaque:
        return FALLBACK_BG

    n = len(opaque)
    return tuple(sorted(c[i] for c in opaque)[n // 2] for i in range(3))


def app_background_color():
    """يقرأ android.backgroundColor من capacitor.config.json إن وُجد."""
    try:
        import json
        cfg = json.loads(Path("capacitor.config.json").read_text(encoding="utf-8"))
        value = str(cfg.get("android", {}).get("backgroundColor", "")).lstrip("#")
        if len(value) == 8:      # AARRGGBB
            value = value[2:]
        if len(value) == 6:
            return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))
    except Exception:
        pass
    return None


def square(img):
    """يقصّ الصورة إلى مربّع من المنتصف إن لم تكن مربّعة."""
    w, h = img.size
    if w == h:
        return img
    side = min(w, h)
    left, top = (w - side) // 2, (h - side) // 2
    return img.crop((left, top, left + side, top + side))


def circular(img):
    """قناع دائري لأيقونة ic_launcher_round."""
    size = img.size[0]
    mask = Image.new("L", (size * 4, size * 4), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size * 4, size * 4), fill=255)
    mask = mask.resize((size, size), Image.LANCZOS)
    out = img.convert("RGBA")
    out.putalpha(mask)
    return out


def save(img, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, "PNG", optimize=True)


def main() -> int:
    if not SOURCE.exists():
        print(f"[تخطٍّ] لا توجد صورة مصدر في {SOURCE} - ستبقى الأيقونة الافتراضية")
        return 0
    if not RES.exists():
        print(f"[خطأ] مجلد الموارد غير موجود: {RES}")
        return 1

    raw = Image.open(SOURCE).convert("RGBA")
    print(f"الصورة المصدر: {SOURCE}  ({raw.size[0]}×{raw.size[1]})")

    src = square(trim_transparent(raw))
    w, _ = src.size
    if w < 512:
        print(f"[تحذير] الصورة صغيرة ({w}px) - يُفضّل 1024×1024 لوضوح أعلى")

    bg = dominant_color(src)
    print(f"لون الخلفية المستخرج: #{bg[0]:02X}{bg[1]:02X}{bg[2]:02X}")

    count = 0

    # 1) الأيقونات التقليدية
    for dpi, size in LAUNCHER_SIZES.items():
        icon = src.resize((size, size), Image.LANCZOS)
        save(icon.convert("RGBA"), RES / f"mipmap-{dpi}" / "ic_launcher.png")
        save(circular(icon), RES / f"mipmap-{dpi}" / "ic_launcher_round.png")
        count += 2

    # 2) طبقة المقدمة للأيقونة التكيّفية
    for dpi, size in FOREGROUND_SIZES.items():
        canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        inner = max(1, int(size * FOREGROUND_RATIO))
        logo = src.resize((inner, inner), Image.LANCZOS)
        offset = (size - inner) // 2
        canvas.paste(logo, (offset, offset), logo)
        save(canvas, RES / f"mipmap-{dpi}" / "ic_launcher_foreground.png")
        count += 1

    # 3) لون خلفية الأيقونة التكيّفية
    bg_xml = RES / "values" / "ic_launcher_background.xml"
    bg_xml.parent.mkdir(parents=True, exist_ok=True)
    bg_xml.write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<resources>\n'
        f'    <color name="ic_launcher_background">#{bg[0]:02X}{bg[1]:02X}{bg[2]:02X}</color>\n'
        '</resources>\n',
        encoding="utf-8"
    )

    # 4) شاشات البداية
    # تُستخدم خلفية التطبيق من capacitor.config.json إن وُجدت، حتى لا يحدث
    # وميض بين شاشة البداية الفاتحة وواجهة التطبيق الداكنة.
    splash_bg = app_background_color() or bg
    print(f"لون شاشة البداية: #{splash_bg[0]:02X}{splash_bg[1]:02X}{splash_bg[2]:02X}")

    def make_splash(size):
        sw, sh = size
        canvas = Image.new("RGBA", (sw, sh), splash_bg + (255,))
        logo_side = max(1, int(min(sw, sh) * 0.38))
        logo = src.resize((logo_side, logo_side), Image.LANCZOS)
        canvas.paste(logo, ((sw - logo_side) // 2, (sh - logo_side) // 2), logo)
        return canvas.convert("RGB")

    for dpi, size in SPLASH_PORT.items():
        save(make_splash(size), RES / f"drawable-port-{dpi}" / "splash.png")
        count += 1
    for dpi, size in SPLASH_LAND.items():
        save(make_splash(size), RES / f"drawable-land-{dpi}" / "splash.png")
        count += 1
    save(make_splash((480, 320)), RES / "drawable" / "splash.png")
    count += 1

    print(f"[نجاح] تم توليد {count} صورة")
    return 0


if __name__ == "__main__":
    sys.exit(main())
