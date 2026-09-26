import React, { Suspense, lazy } from 'react';
import { Loader2, WifiOff } from 'lucide-react';

/**
 * شاشتا الإدارة والتقارير تُحمَّلان عند الحاجة فقط.
 *
 * معهما مكتبة Excel (xlsx) — أكبر جزء في كود التطبيق — ولا يحتاج الموظف
 * أياً منها. كانت كلها في ملف واحد ينزّله كل هاتف ويقرؤه عند كل فتح.
 * الآن تنفصل في ملفات مستقلة لا تُطلب إلا حين يفتح أحدٌ الإدارة أو التقارير.
 *
 * ⚠️ لا تستورد AdminDashboard ولا ReportsView استيراداً مباشراً في App.tsx
 *    أو Login.tsx — سطر واحد يعيدهما (ومكتبة Excel) إلى الملف الرئيسي.
 */
export const LazyAdminDashboard = lazy(() => import('./AdminDashboard'));
export const LazyReportsView = lazy(() => import('./ReportsView'));

const Loading: React.FC = () => (
  <div className="flex items-center justify-center gap-2 py-16 text-slate-400 text-sm font-bold">
    <Loader2 size={18} className="animate-spin" /> جارٍ تحميل الشاشة…
  </div>
);

/**
 * يلتقط فشل تنزيل الشاشة (انقطاع الإنترنت، أو نسخة قديمة مفتوحة بعد نشر
 * جديد فلم يعد ملفها موجوداً). بدونه ينهار التطبيق كله إلى صفحة بيضاء.
 */
class LoadBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(err: unknown) { console.warn('Screen chunk failed to load', err); }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-14 px-4 text-center">
        <WifiOff size={28} className="text-orange-400" />
        <p className="text-sm font-bold text-slate-300">تعذّر تحميل هذه الشاشة.</p>
        <p className="text-xs text-slate-400 font-bold">تأكد من الإنترنت ثم أعد تحميل التطبيق.</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="bg-blue-600 text-white font-black px-6 py-3 rounded-xl text-sm"
        >
          إعادة التحميل
        </button>
      </div>
    );
  }
}

export const ScreenLoader: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <LoadBoundary>
    <Suspense fallback={<Loading />}>{children}</Suspense>
  </LoadBoundary>
);
