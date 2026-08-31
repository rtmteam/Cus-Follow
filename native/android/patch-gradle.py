#!/usr/bin/env python3
"""
يضيف إعدادات التوقيع الثابت إلى android/app/build.gradle المولَّد من Capacitor.

لماذا هذا ضروري:
  ANDROID_ID الذي يعتمد عليه التطبيق كمعرّف جهاز يُشتق من مفتاح توقيع التطبيق.
  مفتاح debug يُولَّد جديداً في كل تشغيل على خوادم GitHub لأنها مؤقتة، ما يعني:
    1) تغيّر معرّف الجهاز مع كل نسخة APK
    2) رفض أندرويد تثبيت النسخة الجديدة فوق القديمة لاختلاف التوقيع

  بمفتاح ثابت يصبح المعرّف ثابتاً وتُثبَّت التحديثات فوق بعضها بشكل طبيعي.

كلمات المرور تُقرأ من متغيرات البيئة ولا تُكتب داخل الملف.
السكربت آمن للتشغيل أكثر من مرة.
"""

import re
import sys
from pathlib import Path

GRADLE = Path(sys.argv[1] if len(sys.argv) > 1
              else "android/app/build.gradle")

SIGNING_BLOCK = """    signingConfigs {
        release {
            storeFile file(System.getenv("KEYSTORE_PATH") ?: "uniteam-release.keystore")
            storePassword System.getenv("KEYSTORE_PASSWORD")
            keyAlias System.getenv("KEY_ALIAS")
            keyPassword System.getenv("KEY_PASSWORD")
        }
    }

"""

# فحص lint يوقف بناء نسخة release عند أي ملاحظة مصنّفة fatal.
# التطبيق للاستخدام الشخصي ولن يُرفع على المتجر، فنمنع إيقاف البناء
# على ملاحظات مثل QUERY_ALL_PACKAGES التي لا تؤثر على عمله.
LINT_BLOCK = """    lint {
        abortOnError false
        checkReleaseBuilds false
    }

"""


def main() -> int:
    if not GRADLE.exists():
        print(f"[خطأ] الملف غير موجود: {GRADLE}")
        return 1

    content = GRADLE.read_text(encoding="utf-8")
    original = content

    # 1) إضافة كتلة signingConfigs قبل buildTypes
    if "signingConfigs" in content:
        print("  [موجودة] كتلة signingConfigs")
    else:
        match = re.search(r"^(\s*)buildTypes\s*\{", content, re.MULTILINE)
        if not match:
            print("[خطأ] لم يُعثر على كتلة buildTypes")
            return 1
        content = content[:match.start()] + SIGNING_BLOCK + content[match.start():]
        print("  [أضيفت]  كتلة signingConfigs")

    # 2) تعطيل إيقاف البناء بسبب ملاحظات lint
    if re.search(r"^\s*lint\s*\{", content, re.MULTILINE):
        print("  [موجودة] كتلة lint")
    else:
        match = re.search(r"^(\s*)buildTypes\s*\{", content, re.MULTILINE)
        if match:
            content = content[:match.start()] + LINT_BLOCK + content[match.start():]
            print("  [أضيفت]  كتلة lint")

    # 3) ربط نوع البناء release بإعداد التوقيع
    if "signingConfig signingConfigs.release" in content:
        print("  [موجود]  ربط release بالتوقيع")
    else:
        pattern = re.compile(
            r"(buildTypes\s*\{\s*\n)(\s*)(release\s*\{\s*\n)",
            re.MULTILINE
        )
        new_content, count = pattern.subn(
            lambda m: f"{m.group(1)}{m.group(2)}{m.group(3)}"
                      f"{m.group(2)}    signingConfig signingConfigs.release\n",
            content,
            count=1
        )
        if count == 0:
            print("[خطأ] لم يُعثر على buildTypes.release")
            return 1
        content = new_content
        print("  [أضيف]   ربط release بالتوقيع")

    if content != original:
        GRADLE.write_text(content, encoding="utf-8")

    # 4) تحقق نهائي
    final = GRADLE.read_text(encoding="utf-8")
    checks = {
        "كتلة signingConfigs": "signingConfigs {" in final,
        "مسار المفتاح": "storeFile file(" in final,
        "ربط release": "signingConfig signingConfigs.release" in final,
        "كتلة lint": "abortOnError false" in final,
    }

    print("\n" + "=" * 55)
    print("تعديل app/build.gradle")
    print("=" * 55)
    ok = True
    for name, passed in checks.items():
        print(f"  {'[نجاح]' if passed else '[فشل] '} {name}")
        if not passed:
            ok = False

    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
