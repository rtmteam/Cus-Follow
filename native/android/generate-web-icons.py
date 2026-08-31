#!/usr/bin/env python3
"""
يولّد أيقونات الموقع وتطبيق الويب (PWA) من نفس صورة أيقونة الأندرويد.

المصدر : resources/icon.png
الهدف  : public/  ← يَنسخها Vite تلقائياً إلى dist أثناء البناء

بذلك تصبح أيقونة واحدة تخدم:
  - تبويب المتصفح (favicon)
  - التطبيق المثبّت من المتصفح على الويندوز
  - التطبيق المثبّت من متصفح الهاتف
  - أيقونة iOS عند الإضافة للشاشة الرئيسية
"""

import hashlib
import json
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("[خطأ] مكتبة Pillow غير مثبّتة. ثبّتها بـ: pip install pillow")
    sys.exit(1)

SOURCE = Path(sys.argv[1] if len(sys.argv) > 1 else "resources/icon.png")
PUBLIC = Path(sys.argv[2] if len(sys.argv) > 2 else "public")

FALLBACK_BG = (0x0F, 0x17, 0x2A)

# الأيقونة القابلة للقصّ: أندرويد وكروم يقتطعان الحواف بأشكال مختلفة،
# والمحتوى المهم يجب أن يبقى داخل 80% الوسطى.
MASKABLE_RATIO = 0.78


def trim_transparent(img):
    if img.mode != "RGBA":
        return img
    bbox = img.split()[-1].getbbox()
    if not bbox:
        return img
    w, h = img.size
    if (bbox[2] - bbox[0]) >= w * 0.97 and (bbox[3] - bbox[1]) >= h * 0.97:
        return img
    print(f"  قُصّ هامش شفاف: {w}×{h} ← {bbox[2]-bbox[0]}×{bbox[3]-bbox[1]}")
    return img.crop(bbox)


def square(img):
    w, h = img.size
    if w == h:
        return img
    side = min(w, h)
    return img.crop(((w - side) // 2, (h - side) // 2,
                     (w - side) // 2 + side, (h - side) // 2 + side))


def dominant_color(img):
    rgba = img.convert("RGBA")
    w, h = rgba.size
    step = max(1, w // 60)
    coords = []
    for x in range(0, w, step):
        coords += [(x, 0), (x, h - 1)]
    for y in range(0, h, step):
        coords += [(0, y), (w - 1, y)]
    opaque = [p for p in (rgba.getpixel(c) for c in coords) if p[3] > 200]
    if not opaque:
        small = rgba.resize((48, 48), Image.LANCZOS)
        opaque = [small.getpixel((x, y)) for x in range(48) for y in range(48)
                  if small.getpixel((x, y))[3] > 200]
    if not opaque:
        return FALLBACK_BG
    n = len(opaque)
    return tuple(sorted(c[i] for c in opaque)[n // 2] for i in range(3))


def save(img, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, "PNG", optimize=True)
    kb = path.stat().st_size / 1024
    print(f"  {path.name:<22} {img.size[0]:>4}×{img.size[1]:<4}  {kb:6.1f} KB")


def main() -> int:
    if not SOURCE.exists():
        print(f"[تخطٍّ] لا توجد صورة مصدر في {SOURCE}")
        return 0
    if not PUBLIC.exists():
        print(f"[خطأ] المجلد غير موجود: {PUBLIC}")
        return 1

    raw = Image.open(SOURCE).convert("RGBA")
    print(f"الصورة المصدر: {SOURCE}  ({raw.size[0]}×{raw.size[1]})")
    src = square(trim_transparent(raw))
    bg = dominant_color(src)
    print(f"لون الخلفية: #{bg[0]:02X}{bg[1]:02X}{bg[2]:02X}")
    print()

    # 1) الأيقونات العادية - المحتوى كاملاً بشفافيته
    save(src.resize((512, 512), Image.LANCZOS), PUBLIC / "icon.png")
    save(src.resize((192, 192), Image.LANCZOS), PUBLIC / "icon-192.png")
    save(src.resize((64, 64), Image.LANCZOS), PUBLIC / "favicon.png")

    # 2) الأيقونة القابلة للقصّ - محتوى مُصغَّر على خلفية معتمة
    canvas = Image.new("RGBA", (512, 512), bg + (255,))
    inner = int(512 * MASKABLE_RATIO)
    logo = src.resize((inner, inner), Image.LANCZOS)
    offset = (512 - inner) // 2
    canvas.paste(logo, (offset, offset), logo)
    save(canvas, PUBLIC / "icon-maskable.png")

    # 3) تحديث manifest.json ليشير إلى المقاسات الصحيحة
    #
    # يُضاف وسم إصدار مشتق من محتوى الصورة إلى كل رابط.
    # السبب: المتصفح يحفر أيقونة التطبيق المثبّت لحظة التثبيت ولا يجدّدها
    # ما دام الرابط كما هو. وبتغيّر الوسم مع تغيّر الصورة يصير الرابط جديداً
    # فيلتقط المتصفح الأيقونة الجديدة.
    version = hashlib.sha1(SOURCE.read_bytes()).hexdigest()[:8]
    print(f"\n  وسم إصدار الأيقونة: {version}")

    manifest_path = PUBLIC / "manifest.json"
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest["icons"] = [
            {"src": f"./icon-192.png?v={version}",      "sizes": "192x192", "type": "image/png", "purpose": "any"},
            {"src": f"./icon.png?v={version}",          "sizes": "512x512", "type": "image/png", "purpose": "any"},
            {"src": f"./icon-maskable.png?v={version}", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
        ]
        manifest_path.write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8"
        )
        print(f"\n  تُحدّث manifest.json ← {len(manifest['icons'])} أيقونات")

    print("\n[نجاح] أيقونات الويب جاهزة")
    return 0


if __name__ == "__main__":
    sys.exit(main())
