package com.uniteam.attendance;

import android.app.AppOpsManager;
import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationManager;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.Build;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import java.util.List;

/**
 * جسر أصلي بين نظام أندرويد وواجهة الويب.
 *
 * يُسجَّل في MainActivity باسم "AndroidBridge"، فيصبح متاحاً في JavaScript
 * عبر window.AndroidBridge ويستدعيه ملف utils.ts مباشرة.
 *
 * كل دالة محاطة بـ try/catch لأن استدعاءها يحدث من WebView،
 * وأي استثناء غير ملتقط قد يوقف الصفحة بالكامل.
 */
public class AndroidBridge {

    private final Context ctx;

    // يُملآن من MainActivity بعد إنشاء الـ WebView، ويُستخدمان في reloadApp
    private WebView webView;
    private String appUrl;

    public AndroidBridge(Context context) {
        this.ctx = context.getApplicationContext();
    }

    /** يربط الجسر بالـ WebView ورابط التطبيق. يُستدعى من MainActivity وحدها. */
    public void attach(WebView webView, String appUrl) {
        this.webView = webView;
        this.appUrl = appUrl;
    }

    // =====================================================
    // 1) معرّف الجهاز الفريد
    // =====================================================

    /**
     * يعيد ANDROID_ID وهو معرّف ثابت مرتبط بـ (الجهاز + المستخدم + مفتاح توقيع التطبيق).
     *
     * يبقى ثابتاً عند حذف التطبيق وإعادة تثبيته طالما أن مفتاح التوقيع لم يتغير.
     * يتغير فقط عند إعادة ضبط المصنع أو تغيير مفتاح التوقيع.
     */
    @JavascriptInterface
    public String getAndroidId() {
        try {
            String id = Settings.Secure.getString(
                    ctx.getContentResolver(),
                    Settings.Secure.ANDROID_ID
            );
            return id == null ? "" : id;
        } catch (Exception e) {
            return "";
        }
    }

    /**
     * معلومات وصفية للجهاز، تُعرض للمشرف عند الحاجة لتمييز الأجهزة.
     */
    @JavascriptInterface
    public String getDeviceModel() {
        try {
            return Build.MANUFACTURER + " " + Build.MODEL;
        } catch (Exception e) {
            return "";
        }
    }

    /**
     * للتأكد من الجانب الآخر أن الجسر يعمل فعلاً.
     */
    @JavascriptInterface
    public boolean isNativeBridgeReady() {
        return true;
    }

    // =====================================================
    // 2) كشف وضع المطور
    // =====================================================

    /**
     * يفحص إعدادات النظام مباشرة:
     * - DEVELOPMENT_SETTINGS_ENABLED: تفعيل قائمة "خيارات المطور"
     * - ADB_ENABLED: تفعيل تصحيح USB
     */
    @JavascriptInterface
    public boolean isDeveloperOptionsEnabled() {
        try {
            int devEnabled = Settings.Global.getInt(
                    ctx.getContentResolver(),
                    Settings.Global.DEVELOPMENT_SETTINGS_ENABLED,
                    0
            );
            if (devEnabled != 0) {
                return true;
            }

            int adbEnabled = Settings.Global.getInt(
                    ctx.getContentResolver(),
                    Settings.Global.ADB_ENABLED,
                    0
            );
            return adbEnabled != 0;
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * يوضح أي الإعدادين هو المفعّل، ليظهر في رسالة التنبيه وسجل المحاولات.
     */
    @JavascriptInterface
    public String getDeveloperOptionsDetail() {
        try {
            int devEnabled = Settings.Global.getInt(
                    ctx.getContentResolver(),
                    Settings.Global.DEVELOPMENT_SETTINGS_ENABLED,
                    0
            );
            int adbEnabled = Settings.Global.getInt(
                    ctx.getContentResolver(),
                    Settings.Global.ADB_ENABLED,
                    0
            );

            if (devEnabled != 0 && adbEnabled != 0) {
                return "خيارات المطور وتصحيح USB مفعّلان";
            }
            if (devEnabled != 0) {
                return "خيارات المطور مفعّلة";
            }
            if (adbEnabled != 0) {
                return "تصحيح USB مفعّل";
            }
            return "";
        } catch (Exception e) {
            return "";
        }
    }

    // =====================================================
    // 3) كشف الموقع الوهمي
    // =====================================================

    /**
     * طبقتان مستقلتان للكشف:
     * أ) فحص آخر موقع معروف من كل مزوّد وقراءة علم isMock عليه
     * ب) البحث عن أي تطبيق مثبّت مُنح صلاحية "تعيين موقع وهمي"
     */
    @JavascriptInterface
    public boolean isMockLocationActive() {
        if (hasMockFlagOnLastLocation()) {
            return true;
        }
        return hasAppWithMockLocationPermission();
    }

    @JavascriptInterface
    public String getMockLocationDetail() {
        if (hasMockFlagOnLastLocation()) {
            return "علم الموقع الوهمي مرفوع على آخر إحداثيات من النظام";
        }
        String pkg = findMockLocationApp();
        if (pkg != null) {
            return "تطبيق ممنوح صلاحية الموقع الوهمي: " + pkg;
        }
        return "";
    }

    private boolean hasMockFlagOnLastLocation() {
        try {
            LocationManager lm = (LocationManager) ctx.getSystemService(Context.LOCATION_SERVICE);
            if (lm == null) {
                return false;
            }

            String[] providers = {
                    LocationManager.GPS_PROVIDER,
                    LocationManager.NETWORK_PROVIDER,
                    LocationManager.PASSIVE_PROVIDER
            };

            for (String provider : providers) {
                try {
                    Location loc = lm.getLastKnownLocation(provider);
                    if (loc != null && isMockLocation(loc)) {
                        return true;
                    }
                } catch (SecurityException se) {
                    // صلاحية الموقع لم تُمنح بعد - نتجاهل هذا المزوّد
                } catch (IllegalArgumentException iae) {
                    // مزوّد غير متاح على هذا الجهاز
                }
            }
        } catch (Exception e) {
            return false;
        }
        return false;
    }

    @SuppressWarnings("deprecation")
    private boolean isMockLocation(Location loc) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                return loc.isMock();
            }
            return loc.isFromMockProvider();
        } catch (Exception e) {
            return false;
        }
    }

    private boolean hasAppWithMockLocationPermission() {
        return findMockLocationApp() != null;
    }

    /** الصلاحية التي يعلنها أي برنامج موقع وهمي حقيقي في ملف الـ Manifest الخاص به */
    private static final String MOCK_PERMISSION = "android.permission.ACCESS_MOCK_LOCATION";

    /** بادئات حزم الشركات المصنّعة - تُستثنى احتياطاً حتى لو حُدّثت من المتجر */
    private static final String[] VENDOR_PREFIXES = {
            "com.android.", "com.google.android.", "android.",
            "com.samsung.", "com.sec.", "com.sec.android.",
            "com.miui.", "com.xiaomi.", "com.mi.",
            "com.huawei.", "com.hihonor.",
            "com.oppo.", "com.coloros.", "com.oplus.",
            "com.vivo.", "com.bbk.",
            "com.oneplus.", "com.motorola.", "com.lge.", "com.transsion.",
            "com.qualcomm.", "com.mediatek."
    };

    /**
     * يبحث عن برنامج موقع وهمي حقيقي مثبّت من المستخدم.
     *
     * الفحص القديم كان يكتفي بسؤال AppOps، وهذا خطأ:
     * نظام AppOps يعيد MODE_ALLOWED افتراضياً لتطبيقات النظام المثبّتة مسبقاً
     * حتى لو لم تستخدم الصلاحية إطلاقاً، فظهرت تطبيقات مثل
     * com.samsung.android.smartswitchassistant كأنها برامج موقع وهمي.
     *
     * الشروط الثلاثة الآن يجب أن تتحقق معاً:
     *   1) التطبيق ليس تطبيق نظام ولا تحديثاً لتطبيق نظام
     *   2) لا ينتمي لبادئات حزم الشركات المصنّعة
     *   3) يعلن صلاحية ACCESS_MOCK_LOCATION في Manifest الخاص به
     *   4) ومنحه النظام العملية فعلياً عبر AppOps
     */
    private String findMockLocationApp() {
        try {
            PackageManager pm = ctx.getPackageManager();
            AppOpsManager aom = (AppOpsManager) ctx.getSystemService(Context.APP_OPS_SERVICE);
            if (pm == null || aom == null) {
                return null;
            }

            List<PackageInfo> packages = pm.getInstalledPackages(PackageManager.GET_PERMISSIONS);
            String selfPackage = ctx.getPackageName();

            for (PackageInfo pkgInfo : packages) {
                if (pkgInfo == null || pkgInfo.packageName == null) {
                    continue;
                }

                String pkgName = pkgInfo.packageName;
                if (pkgName.equals(selfPackage)) {
                    continue;
                }

                ApplicationInfo app = pkgInfo.applicationInfo;
                if (app == null) {
                    continue;
                }

                // 1) استثناء تطبيقات النظام
                if ((app.flags & ApplicationInfo.FLAG_SYSTEM) != 0) {
                    continue;
                }
                if ((app.flags & ApplicationInfo.FLAG_UPDATED_SYSTEM_APP) != 0) {
                    continue;
                }

                // 2) استثناء حزم الشركات المصنّعة
                if (isVendorPackage(pkgName)) {
                    continue;
                }

                // 3) يجب أن يعلن التطبيق صلاحية الموقع الوهمي صراحةً
                if (!declaresMockPermission(pkgInfo)) {
                    continue;
                }

                // 4) وأن يكون النظام قد منحه العملية فعلاً
                try {
                    int mode;
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        mode = aom.unsafeCheckOpNoThrow(
                                AppOpsManager.OPSTR_MOCK_LOCATION,
                                app.uid,
                                pkgName
                        );
                    } else {
                        mode = aom.checkOpNoThrow(
                                AppOpsManager.OPSTR_MOCK_LOCATION,
                                app.uid,
                                pkgName
                        );
                    }

                    if (mode == AppOpsManager.MODE_ALLOWED) {
                        return pkgName;
                    }
                } catch (Exception ignored) {
                    // بعض الحزم ترفض الاستعلام - نتجاوزها
                }
            }
        } catch (Exception e) {
            return null;
        }
        return null;
    }

    private boolean isVendorPackage(String pkgName) {
        for (String prefix : VENDOR_PREFIXES) {
            if (pkgName.startsWith(prefix)) {
                return true;
            }
        }
        return false;
    }

    private boolean declaresMockPermission(PackageInfo pkgInfo) {
        String[] requested = pkgInfo.requestedPermissions;
        if (requested == null) {
            return false;
        }
        for (String permission : requested) {
            if (MOCK_PERMISSION.equals(permission)) {
                return true;
            }
        }
        return false;
    }

    // =====================================================
    // 4) الاتصال وإعادة التحميل - تستخدمهما صفحة offline.html
    // =====================================================

    /**
     * فحص وجود اتصال حقيقي بالإنترنت من نظام أندرويد.
     *
     * أدق بكثير من navigator.onLine داخل WebView، فتلك تكتفي بوجود واجهة شبكة
     * نشطة وتعيد true حتى لو كان الواي فاي متصلاً بلا إنترنت.
     * هنا نشترط NET_CAPABILITY_VALIDATED أي أن النظام تحقق فعلياً من وصول الإنترنت.
     */
    @JavascriptInterface
    public boolean isConnected() {
        try {
            ConnectivityManager cm =
                    (ConnectivityManager) ctx.getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm == null) {
                return false;
            }

            Network network = cm.getActiveNetwork();
            if (network == null) {
                return false;
            }

            NetworkCapabilities caps = cm.getNetworkCapabilities(network);
            if (caps == null) {
                return false;
            }

            return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                    && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED);
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * إعادة تحميل التطبيق على رابطه الأصلي داخل الـ WebView نفسه.
     *
     * لا يجوز استخدام location.reload من صفحة الخطأ: عنوانها محلي
     * (https://localhost/offline.html) وCapacitor يعامل أي عنوان خارج نطاق
     * الخادم كرابط خارجي فيفتحه في المتصفح، فيظهر ERR_CONNECTION_REFUSED.
     *
     * التنفيذ يمر عبر webView.post لأن استدعاءات JavascriptInterface
     * تصل على خيط منفصل، ولا يجوز لمس الـ WebView إلا من خيط الواجهة.
     */
    @JavascriptInterface
    public void reloadApp() {
        final WebView view = this.webView;
        final String url = this.appUrl;

        if (view == null || url == null || url.trim().isEmpty()) {
            return;
        }

        view.post(new Runnable() {
            @Override
            public void run() {
                try {
                    view.loadUrl(url);
                } catch (Exception e) {
                    android.util.Log.e("Uniteam", "reloadApp failed", e);
                }
            }
        });
    }

    /** يتيح للصفحة معرفة أنها تعمل داخل التطبيق وأن إعادة التحميل متاحة */
    @JavascriptInterface
    public boolean canReloadApp() {
        return this.webView != null && this.appUrl != null && !this.appUrl.trim().isEmpty();
    }

    // =====================================================
    // 5) التحديث الذاتي — تنزيل APK وفتح مثبّت النظام
    // =====================================================

    /**
     * رقم النسخة الظاهر للمستخدم، مثل "3.0.12".
     * يُعرض في شريط التحديث ليعرف الموظف أي نسخة يحمل.
     */
    @JavascriptInterface
    public String getAppVersion() {
        try {
            PackageInfo info = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0);
            return info.versionName == null ? "" : info.versionName;
        } catch (Exception e) {
            return "";
        }
    }

    /**
     * رقم البناء الصحيح — هو أساس المقارنة لا versionName.
     *
     * versionName نصّ حرّ تختلف طرق مقارنته ("3.0.9" أكبر أم أصغر من "3.0.10"؟)،
     * أما versionCode فعدد صحيح يتزايد، فالمقارنة به قاطعة.
     */
    @JavascriptInterface
    public long getAppVersionCode() {
        try {
            PackageInfo info = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                return info.getLongVersionCode();
            }
            return (long) info.versionCode;
        } catch (Exception e) {
            return 0L;
        }
    }

    /** هل يملك التطبيق إذن تثبيت الحزم؟ أندرويد 8+ يشترطه لكل تطبيق على حدة. */
    @JavascriptInterface
    public boolean canInstallApk() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                return ctx.getPackageManager().canRequestPackageInstalls();
            }
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /** يفتح شاشة النظام ليمنح المستخدم إذن التثبيت من هذا التطبيق. */
    @JavascriptInterface
    public void openInstallPermissionSettings() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                android.content.Intent intent = new android.content.Intent(
                        Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        android.net.Uri.parse("package:" + ctx.getPackageName())
                );
                intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(intent);
            }
        } catch (Exception e) {
            android.util.Log.e("Uniteam", "openInstallPermissionSettings failed", e);
        }
    }

    /**
     * ينزّل ملف APK ثم يفتح مثبّت النظام.
     *
     * ملاحظات تنفيذية:
     *  - التنزيل على خيط منفصل: استدعاءات JavascriptInterface تصل على خيط
     *    غير خيط الواجهة، لكن الشبكة ممنوعة على الخيط الرئيسي أصلاً.
     *  - الملف يُكتب في getExternalFilesDir وهو مجلد خاص بالتطبيق لا يحتاج
     *    أي صلاحية تخزين، ويُشارَك عبر FileProvider.
     *  - أندرويد لا يسمح بتثبيت صامت خارج المتجر: ستظهر شاشة تأكيد دائماً.
     *  - التقدّم يُبلَّغ للصفحة عبر window.onApkDownloadProgress إن عُرّفت.
     */
    @JavascriptInterface
    public void downloadAndInstallApk(final String url) {
        if (url == null || url.trim().isEmpty()) {
            notifyUpdate("error", "رابط التحديث غير صالح");
            return;
        }

        new Thread(new Runnable() {
            @Override
            public void run() {
                java.io.InputStream in = null;
                java.io.FileOutputStream out = null;
                java.net.HttpURLConnection conn = null;
                try {
                    notifyUpdate("start", "");

                    java.net.URL target = new java.net.URL(url);
                    conn = (java.net.HttpURLConnection) target.openConnection();
                    conn.setInstanceFollowRedirects(true);
                    conn.setConnectTimeout(30000);
                    conn.setReadTimeout(60000);
                    conn.connect();

                    int code = conn.getResponseCode();
                    if (code < 200 || code >= 300) {
                        notifyUpdate("error", "تعذّر تنزيل التحديث (رمز " + code + ")");
                        return;
                    }

                    int total = conn.getContentLength();

                    java.io.File dir = ctx.getExternalFilesDir(null);
                    if (dir == null) {
                        notifyUpdate("error", "تعذّر الوصول إلى مساحة التخزين");
                        return;
                    }
                    java.io.File apk = new java.io.File(dir, "uniteam-update.apk");
                    if (apk.exists() && !apk.delete()) {
                        android.util.Log.w("Uniteam", "could not delete previous apk");
                    }

                    in = conn.getInputStream();
                    out = new java.io.FileOutputStream(apk);

                    byte[] buffer = new byte[8192];
                    long written = 0;
                    int lastPercent = -1;
                    int read;
                    while ((read = in.read(buffer)) != -1) {
                        out.write(buffer, 0, read);
                        written += read;
                        if (total > 0) {
                            int percent = (int) (written * 100 / total);
                            if (percent != lastPercent) {
                                lastPercent = percent;
                                notifyUpdate("progress", String.valueOf(percent));
                            }
                        }
                    }
                    out.flush();
                    out.close();
                    out = null;

                    notifyUpdate("installing", "");
                    launchInstaller(apk);

                } catch (Exception e) {
                    android.util.Log.e("Uniteam", "downloadAndInstallApk failed", e);
                    notifyUpdate("error", "فشل تنزيل التحديث. تأكد من الإنترنت وحاول مجدداً.");
                } finally {
                    try { if (in != null) in.close(); } catch (Exception ignored) {}
                    try { if (out != null) out.close(); } catch (Exception ignored) {}
                    if (conn != null) conn.disconnect();
                }
            }
        }).start();
    }

    /** يفتح شاشة تثبيت النظام على الملف المنزَّل عبر FileProvider. */
    private void launchInstaller(java.io.File apk) {
        try {
            android.net.Uri uri = androidx.core.content.FileProvider.getUriForFile(
                    ctx, ctx.getPackageName() + ".fileprovider", apk
            );

            android.content.Intent intent = new android.content.Intent(android.content.Intent.ACTION_VIEW);
            intent.setDataAndType(uri, "application/vnd.android.package-archive");
            intent.addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(intent);
        } catch (Exception e) {
            android.util.Log.e("Uniteam", "launchInstaller failed", e);
            notifyUpdate("error", "تعذّر فتح شاشة التثبيت");
        }
    }

    /**
     * يبلّغ صفحة الويب بحالة التحديث.
     * لا يفعل شيئاً إن لم تُعرّف الصفحة الدالة، فلا يتعطّل شيء.
     */
    private void notifyUpdate(final String state, final String detail) {
        final WebView view = this.webView;
        if (view == null) {
            return;
        }
        final String js = "window.onApkUpdateState && window.onApkUpdateState("
                + jsString(state) + "," + jsString(detail) + ")";
        view.post(new Runnable() {
            @Override
            public void run() {
                try {
                    view.evaluateJavascript(js, null);
                } catch (Exception e) {
                    android.util.Log.e("Uniteam", "notifyUpdate failed", e);
                }
            }
        });
    }

    /** تهريب بسيط لنصّ يُمرَّر إلى JavaScript */
    private String jsString(String raw) {
        String s = raw == null ? "" : raw;
        s = s.replace("\\", "\\\\").replace("'", "\\'").replace("\n", " ").replace("\r", " ");
        return "'" + s + "'";
    }

    // =====================================================
    // 6) تشخيص - يساعد على تفسير أي رفض غير متوقع
    // =====================================================

    /**
     * ملخص نصي لحالة الأمان على الجهاز، يظهر للمشرف عند الحاجة.
     */
    @JavascriptInterface
    public String getSecurityDiagnostics() {
        StringBuilder sb = new StringBuilder();
        try {
            sb.append("الجهاز: ").append(getDeviceModel()).append("\n");
            sb.append("إصدار أندرويد: ").append(Build.VERSION.SDK_INT).append("\n");
            sb.append("معرّف الجهاز: ").append(getAndroidId()).append("\n");
            sb.append("وضع المطور: ")
              .append(isDeveloperOptionsEnabled() ? "مفعّل" : "معطّل").append("\n");
            sb.append("علم الموقع الوهمي: ")
              .append(hasMockFlagOnLastLocation() ? "مرفوع" : "غير مرفوع").append("\n");
            String app = findMockLocationApp();
            sb.append("تطبيق موقع وهمي: ")
              .append(app == null ? "لا يوجد" : app);
        } catch (Exception e) {
            sb.append("تعذر جمع التشخيص");
        }
        return sb.toString();
    }
}
