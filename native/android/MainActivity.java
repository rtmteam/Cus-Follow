package com.uniteam.attendance;

import android.os.Bundle;
import android.view.View;
import android.webkit.WebView;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.BridgeActivity;

/**
 * نقطة دخول التطبيق.
 *
 * إضافتان على النسخة الافتراضية من Capacitor:
 *   ١) تسجيل الجسر الأصلي باسم "AndroidBridge" ليصبح متاحاً في window.AndroidBridge
 *   ٢) إبعاد الواجهة عن شريطَي النظام (انظر applySystemBarInsets أدناه)
 *
 * التسجيل يتم مباشرة بعد super.onCreate لأن الـ WebView يكون قد أُنشئ عندها،
 * وقبل أن تبدأ صفحة الويب في تنفيذ الـ JavaScript الخاص بها.
 */
public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        try {
            // بعد عودة super.onCreate يكون Capacitor قد أنشأ الـ Bridge والـ WebView،
            // ولم تبدأ الصفحة تنفيذ JavaScript بعد.
            if (this.getBridge() != null) {
                WebView webView = this.getBridge().getWebView();
                if (webView != null) {
                    AndroidBridge bridge = new AndroidBridge(this);

                    // رابط التطبيق الأصلي: الخادم البعيد إن حُدّد، وإلا الرابط المحلي.
                    // تحتاجه صفحة انقطاع الاتصال لتعيد التحميل على العنوان الصحيح
                    // بدل عنوانها المحلي الذي يفتح المتصفح ويفشل.
                    String appUrl = this.getBridge().getServerUrl();
                    if (appUrl == null || appUrl.trim().isEmpty()) {
                        appUrl = this.getBridge().getAppUrl();
                    }
                    bridge.attach(webView, appUrl);

                    webView.addJavascriptInterface(bridge, "AndroidBridge");
                    android.util.Log.i("Uniteam", "AndroidBridge registered, appUrl=" + appUrl);
                }
            }
        } catch (Exception e) {
            // في حال فشل التسجيل يستمر التطبيق بالعمل،
            // وتتحول واجهة الويب تلقائياً إلى البدائل المتاحة.
            android.util.Log.e("Uniteam", "AndroidBridge registration failed", e);
        }

        // خارج try/catch الجسر عمداً.
        // كانت هذه الاستدعاءة بداخله، فأي استثناء في تسجيل الجسر كان يتخطّاها
        // بصمت فتبقى الواجهة تحت شريطَي النظام بلا أي أثر في السجلّ.
        applySystemBarInsets();
    }

    /**
     * إبعاد الواجهة عن شريط الحالة أعلى الشاشة وشريط التنقّل أسفلها.
     *
     * أندرويد ١٦ يفرض العرض من حافة إلى حافة فرضاً مطلقاً على كل تطبيق مبنيّ
     * بـ SDK 36 — والبناء هنا بـ SDK 36. والسمة windowOptOutEdgeToEdgeEnforcement
     * التي كانت تُعطّل هذا السلوك في أندرويد ١٥ صارت مُهمَلة ومتجاهَلة تماماً
     * في أندرويد ١٦، فلم يبقَ إلا التعامل الصحيح مع الحواف.
     *
     * ثلاثة فروق جوهرية عن النسخة السابقة التي لم تكن تعمل:
     *
     *   ١) الحشو يُطبَّق على **جذر المحتوى** (android.R.id.content) لا على الـ WebView.
     *      setOnApplyWindowInsetsListener يستبدل المستمع ولا يضيفه، وCapacitor
     *      يسجّل مستمعه على الـ WebView فيمحو مستمعنا بلا أثر.
     *
     *   ٢) requestApplyInsets وحدها لا تكفي: إن لم يكن العرض مرتبطاً بالنافذة بعد
     *      فلن يستجيب النظام. لذا نطلب التوزيع مجدداً عند الارتباط.
     *
     *   ٣) عند تعذّر الوصول إلى جذر المحتوى نرجع إلى الـ WebView كشبكة أمان.
     *
     * ما خلف الشريطين يظهر بلون خلفية النافذة المضبوط في capacitor.config.json
     * (#0A1428) فيبدو امتداداً للترويسة الكحلية لا فراغاً أسود.
     *
     * نُعيد WindowInsetsCompat.CONSUMED حتى لا تصل الحواف إلى الـ WebView مرة
     * أخرى، فتظلّ env(safe-area-inset-*) في CSS أصفاراً ولا يتراكم الحشو.
     *
     * ---- لوحة المفاتيح ----
     * لأننا نستهلك الحواف، صار لزاماً علينا أن نتدبّر لوحة المفاتيح بأنفسنا:
     * لا شيء بعدنا يراها. ومع فرض العرض من حافة إلى حافة لم يعد adjustResize
     * يقلّص النافذة تلقائياً كما كان.
     *
     * لذا الحشو السفلي = الأكبر بين شريط التنقّل ولوحة المفاتيح. «الأكبر» لا
     * «المجموع»: اللوحة تغطّي شريط التنقّل حين تظهر، فجمعهما يخلّف فراغاً
     * بارتفاع الشريط فوق اللوحة.
     */
    private void applySystemBarInsets() {
        View target = findViewById(android.R.id.content);

        if (target == null && this.getBridge() != null) {
            target = this.getBridge().getWebView();
        }
        if (target == null) {
            android.util.Log.e("Uniteam", "insets: no target view found");
            return;
        }

        final View view = target;

        ViewCompat.setOnApplyWindowInsetsListener(view, (v, windowInsets) -> {
            Insets bars = windowInsets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
            );
            Insets ime = windowInsets.getInsets(WindowInsetsCompat.Type.ime());

            int bottom = Math.max(bars.bottom, ime.bottom);

            v.setPadding(bars.left, bars.top, bars.right, bottom);
            android.util.Log.i("Uniteam",
                "insets applied top=" + bars.top + " bottom=" + bottom +
                " (bars=" + bars.bottom + " ime=" + ime.bottom + ")" +
                " left=" + bars.left + " right=" + bars.right);
            return WindowInsetsCompat.CONSUMED;
        });

        // إن كان العرض مرتبطاً بالنافذة فعلاً نطلب التوزيع فوراً،
        // وإلا ننتظر لحظة الارتباط ونطلبه عندها.
        if (view.isAttachedToWindow()) {
            ViewCompat.requestApplyInsets(view);
        } else {
            view.addOnAttachStateChangeListener(new View.OnAttachStateChangeListener() {
                @Override
                public void onViewAttachedToWindow(View v) {
                    ViewCompat.requestApplyInsets(v);
                    v.removeOnAttachStateChangeListener(this);
                }

                @Override
                public void onViewDetachedFromWindow(View v) {
                    // لا شيء
                }
            });
        }
    }

    /**
     * شبكة أمان أخيرة: عند أول مرة تحصل فيها النافذة على التركيز تكون الحواف
     * قد صارت معلومة للنظام يقيناً. إن كانت لم تُطبَّق بعد لأي سبب، هذه تُطبّقها.
     */
    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            View target = findViewById(android.R.id.content);
            if (target != null && target.getPaddingTop() == 0) {
                ViewCompat.requestApplyInsets(target);
            }
        }
    }
}
