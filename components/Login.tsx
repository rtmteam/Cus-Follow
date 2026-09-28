
import React, { useState, useRef, useEffect } from 'react';
import { User, AppConfig } from '../types';
import { LogIn, LogOut, ShieldAlert, Loader2, Smartphone, AlertCircle, WifiOff, Eye, EyeOff, FileSpreadsheet, KeyRound, Info } from 'lucide-react';
import { getDeviceFingerprint } from '../utils';
import { LogoMark } from './Logo';
import { LazyReportsView, ScreenLoader } from './LazyScreens';
import { postJson, describeConnectionError, wakeServer } from '../api';

/**
 * مهلة طلب الدخول.
 *
 * الدخول طلب واحد للخادم: يتحقّق ويربط الجهاز ويُعيد بيانات الموظف معاً.
 * كانت ٢٠ ثانية، لكن قيس في ٢٨ سبتمبر أن الخادم النائم يستيقظ في ١٥–١٧
 * ثانية، فكانت المهلة تنتهي على بيانات الهاتف قبل وصول ردّ سليم. الطلب آمن
 * للإعادة: لو انقطع الردّ بعد ربط الجهاز، فالمحاولة الثانية تجده مربوطاً.
 */
const LOGIN_TIMEOUT_MS = 40000;

/** بعدها تتغيّر رسالة الانتظار — الطلب ما زال جارياً ولم يفشل */
const SLOW_HINT_MS = 8000;

interface LoginProps {
  /**
   * دخول ناجح تحقّق منه الخادم.
   * data ردّ الخادم نفسه — يحمل بيانات المستخدم فلا يلزم طلب ثانٍ.
   */
  onLogin: (
    user: User,
    data: any,
    requestStartedAt: number,
    admin?: { username: string; password: string }
  ) => void;
  adminConfig: AppConfig;
  setAdminConfig: (cfg: Partial<AppConfig>) => void;
  logAction: (action: string, details?: string) => void;
  /** يفتح شاشة التقارير كصفحة مستقلة أو داخلية */
  onOpenReports?: () => void;
  /** سبب إخراج المستخدم إن أخرجه الخادم (كلمة مرور تغيّرت · جهاز فُكّ ربطه) */
  notice?: string;
}

export default function Login({ 
  onLogin, 
  adminConfig, 
  setAdminConfig,
  logAction,
  onOpenReports,
  notice
}: LoginProps) {
  const [mode, setMode] = useState<'login' | 'admin' | 'reports'>('login');
  const [isReportsLoggedIn, setIsReportsLoggedIn] = useState(false);
  const reportsLogoutRef = useRef<(() => void) | null>(null);
  const [nationalId, setNationalId] = useState('');
  const [password, setPassword] = useState('');
  const [adminUsername, setAdminUsername] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showAdminPassword, setShowAdminPassword] = useState(false);
  const [isSlow, setIsSlow] = useState(false);

  // إيقاظ الخادم لحظة ظهور شاشة الدخول: يكتب الموظف رقمه وكلمة مروره
  // (١٠–٢٠ ثانية عادةً) بينما يستيقظ الخادم، فيجده جاهزاً حين يضغط «دخول».
  const wakeUrl = adminConfig.syncUrl || adminConfig.googleSheetLink;
  useEffect(() => { wakeServer(wakeUrl); }, [wakeUrl]);

  useEffect(() => {
    if (!isLoading) { setIsSlow(false); return; }
    const t = setTimeout(() => setIsSlow(true), SLOW_HINT_MS);
    return () => clearTimeout(t);
  }, [isLoading]);

  // ---------- استعادة كلمة المرور ----------
  // شاشة من خطوتين: تحقّق من الهوية والجهاز، ثم تعيين كلمة جديدة.
  // التحقق كله في الخادم — القائمة المحلية لا يُعتمد عليها هنا.
  const [showRecovery, setShowRecovery] = useState(false);
  const [recStep, setRecStep] = useState<1 | 2>(1);
  const [recNationalId, setRecNationalId] = useState('');
  const [recNewPass, setRecNewPass] = useState('');
  const [recConfirmPass, setRecConfirmPass] = useState('');
  const [recShowPass, setRecShowPass] = useState(false);
  const [recVerifiedName, setRecVerifiedName] = useState('');
  const [recError, setRecError] = useState('');
  const [recSuccess, setRecSuccess] = useState('');
  const [recLoading, setRecLoading] = useState(false);

  const closeRecovery = () => {
    setShowRecovery(false);
    setRecStep(1);
    setRecNationalId('');
    setRecNewPass('');
    setRecConfirmPass('');
    setRecVerifiedName('');
    setRecError('');
    setRecSuccess('');
  };

  /** نداء الخادم لإجراء الاستعادة الذاتية — بلا no-cors ليُقرأ الردّ فعلاً */
  const callRecovery = async (newPassword?: string) => {
    const response = await fetch(adminConfig.syncUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'resetPasswordSelf',
        nationalId: recNationalId.trim(),
        deviceId: getDeviceFingerprint(),
        newPassword: newPassword
      })
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    if (!text || text.trim().startsWith('<')) throw new Error('INVALID_RESPONSE');
    return text.trim();
  };

  /** الخطوة الأولى: التحقق من الهوية والجهاز بلا كتابة أي شيء */
  const handleRecoveryVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setRecError('');

    if (!navigator.onLine) {
      setRecError('لا يمكن استعادة كلمة المرور والجهاز غير متصل بالإنترنت.');
      return;
    }
    if (!adminConfig.syncUrl) {
      setRecError('التطبيق غير مربوط بالسحابة. راجع المسؤول.');
      return;
    }
    if (!recNationalId.trim()) {
      setRecError('يرجى إدخال الرقم القومي.');
      return;
    }

    setRecLoading(true);
    try {
      const text = await callRecovery();
      if (text.startsWith('Verified:')) {
        setRecVerifiedName(text.replace('Verified:', '').trim());
        setRecStep(2);
        logAction('طلب استعادة كلمة مرور', `الرقم القومي: ${recNationalId.trim()}`);
      } else {
        setRecError(text.replace(/^Error:\s*/, ''));
        logAction('فشل التحقق لاستعادة كلمة المرور', `الرقم القومي: ${recNationalId.trim()} | ${text}`);
      }
    } catch (err: any) {
      setRecError(
        err.message === 'INVALID_RESPONSE'
          ? 'رابط الشركة لا يؤدي إلى كود النظام. راجع المسؤول.'
          : 'تعذر الاتصال بالخادم. تأكد من الإنترنت وحاول مجدداً.'
      );
    } finally {
      setRecLoading(false);
    }
  };

  /** الخطوة الثانية: تعيين كلمة المرور الجديدة */
  const handleRecoverySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setRecError('');

    const pass = recNewPass.trim();
    if (pass.length < 6) { setRecError('كلمة المرور يجب ألا تقل عن ٦ خانات.'); return; }
    if (pass.startsWith('0')) { setRecError('كلمة المرور لا يمكن أن تبدأ بصفر.'); return; }
    if (pass !== recConfirmPass.trim()) { setRecError('كلمتا المرور غير متطابقتين.'); return; }

    setRecLoading(true);
    try {
      const text = await callRecovery(pass);
      if (text.includes('Password Reset Successfully')) {
        setRecSuccess('تم تغيير كلمة المرور بنجاح. يمكنك الدخول بها الآن.');
        logAction('نجاح استعادة كلمة المرور', `الموظف: ${recVerifiedName}`);
        // الدخول يتحقّق في الخادم مباشرةً، فكلمة المرور الجديدة تعمل فوراً
        setNationalId(recNationalId.trim());
        setTimeout(closeRecovery, 2200);
      } else {
        setRecError(text.replace(/^Error:\s*/, ''));
      }
    } catch (err: any) {
      setRecError(
        err.message === 'INVALID_RESPONSE'
          ? 'رابط الشركة لا يؤدي إلى كود النظام. راجع المسؤول.'
          : 'تعذر الاتصال بالخادم. تأكد من الإنترنت وحاول مجدداً.'
      );
    } finally {
      setRecLoading(false);
    }
  };

  /**
   * دخول الموظف — التحقق كله في الخادم.
   *
   * كان التطبيق ينزّل قائمة الموظفين كلها بكلمات مرورهم ويتحقّق على الهاتف،
   * ثم يطلب من الخادم ربط الجهاز بإجراء بلا مصادقة. الآن طلب واحد: الخادم
   * يتحقّق من الرقم القومي وكلمة المرور، ويفحص أن الهاتف ليس لموظف آخر،
   * ويربطه إن بقي في الحصّة، ويُعيد بيانات هذا الموظف وحده.
   */
  const handleEmployeeLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;

    if (!navigator.onLine) {
      setError('عذراً، لا يمكن تسجيل الدخول والجهاز غير متصل بالإنترنت.');
      logAction('فشل تسجيل دخول موظف', 'السبب: الجهاز غير متصل بالإنترنت');
      return;
    }

    const trimmedNId = nationalId.trim();
    const trimmedPass = password.trim();
    if (!trimmedNId || !trimmedPass) {
      setError('أدخل الرقم القومي وكلمة المرور.');
      return;
    }

    const syncTargetUrl = adminConfig.syncUrl || adminConfig.googleSheetLink;
    if (!syncTargetUrl) {
      setError('التطبيق لم يتصل بالخادم بعد. انتظر لحظات ثم أعد المحاولة، وإن تكرّر راجع المسؤول.');
      return;
    }

    setIsLoading(true);
    setError('');

    const deviceId = getDeviceFingerprint();
    const startedAt = Date.now();

    let data: any;
    try {
      data = await postJson(syncTargetUrl, {
        action: 'login',
        nationalId: trimmedNId,
        password: trimmedPass,
        deviceId
      }, LOGIN_TIMEOUT_MS);
    } catch (err: any) {
      setIsLoading(false);
      const msg = describeConnectionError(err);
      setError(msg);
      logAction('فشل تسجيل دخول موظف', `الرقم القومي: ${trimmedNId} | ${msg} | ${err?.message || err?.name || ''}`);
      return;
    }

    if (!data || data.status !== 'ok' || !data.user) {
      setIsLoading(false);
      setError((data && data.message) || 'تعذّر الدخول. حاول مجدداً.');
      logAction('فشل تسجيل دخول موظف', `الرقم القومي: ${trimmedNId} | ${(data && data.code) || 'ردّ غير متوقع'}`);
      return;
    }

    const user: User = { ...data.user, role: 'employee' };
    logAction(
      data.linkedNow ? 'تسجيل دخول موظف (ربط جهاز جديد)' : 'تسجيل دخول موظف',
      `الموظف: ${user.fullName}, الجهاز: ${deviceId}`
    );
    setIsLoading(false);
    onLogin(user, data, startedAt);
  };

  /**
   * دخول المسؤول — يتحقّق منه الخادم لا التطبيق.
   * كانت كلمة المرور تُقارَن بنسخة مكتوبة داخل حزمة JS العلنية.
   */
  const handleAdminSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;

    const user = adminUsername.trim();
    const pass = adminPassword.trim();
    if (!user || !pass) {
      setError('أدخل اسم المستخدم وكلمة المرور.');
      return;
    }
    if (!navigator.onLine) {
      setError('لا يمكن دخول لوحة الإدارة والجهاز غير متصل بالإنترنت.');
      return;
    }
    if (!adminConfig.syncUrl) {
      setError('التطبيق لم يتصل بالخادم بعد. انتظر لحظات ثم أعد المحاولة.');
      return;
    }

    setIsLoading(true);
    setError('');
    const startedAt = Date.now();

    let data: any;
    try {
      data = await postJson(adminConfig.syncUrl, {
        action: 'getAdminData',
        adminUsername: user,
        adminPassword: pass
      }, 45000);
    } catch (err: any) {
      setIsLoading(false);
      setError(describeConnectionError(err));
      logAction('فشل تسجيل دخول مسؤول', `المسؤول: ${user} | ${err?.message || err?.name || ''}`);
      return;
    }

    if (!data || data.status !== 'ok') {
      setIsLoading(false);
      setError((data && data.message) || 'بيانات دخول المسؤول غير صحيحة.');
      logAction('فشل تسجيل دخول مسؤول', `حساب غير مصرح له كمسؤول: ${user}`);
      return;
    }

    logAction('تسجيل دخول مسؤول', `المسؤول: ${user}`);
    setIsLoading(false);
    setAdminPassword('');
    onLogin(
      { id: 'admin-id', fullName: 'المسؤول', nationalId: '000', role: 'admin' },
      data,
      startedAt,
      { username: user, password: pass }
    );
  };

  const inputClasses = "w-full px-4 py-3.5 rounded-2xl border border-slate-600 bg-slate-900 text-white placeholder:text-slate-500 font-bold outline-none focus:border-blue-500 transition-all shadow-inner";

  // لا تبويب «حساب جديد»: الحسابات يُنشئها المسؤول وحده من لوحة الإدارة
  const TABS: { id: 'login' | 'admin' | 'reports'; label: string; icon: any; desc: string }[] = [
    { id: 'login',    label: 'دخول الموظف', icon: LogIn,       desc: 'سجّل زياراتك للعملاء' },
    { id: 'admin',    label: 'الإدارة',      icon: ShieldAlert, desc: 'لوحة تحكم المسؤول' },
    { id: 'reports',  label: 'التقارير',    icon: FileSpreadsheet, desc: 'عرض وتصدير السجلات' }
  ];

  const showSidebar = !(mode === 'reports' && isReportsLoggedIn);

  return (
    <div className={`login-shell login-shell--reports-full ${mode === 'reports' ? (isReportsLoggedIn ? '!max-w-none !w-full !grid-cols-1' : 'max-w-6xl') : ''}`}>

      {/* ===================== القائمة الجانبية ===================== */}
      {showSidebar && (
        <aside className="login-side">
          <div className="login-side__head">
            <div className="flex justify-center mb-3">
              <LogoMark size={132} variant="full" />
            </div>
            <div className="login-side__sub">متابعة العملاء</div>
          </div>

          <nav className="login-side__nav">
            {TABS.filter(t => t.id !== 'reports').map(t => (
              <button
                key={t.id}
                type="button"
                onClick={() => { setMode(t.id); setError(''); }}
                className={`login-tab${mode === t.id ? ' login-tab--active' : ''}`}
              >
                <t.icon size={17} className="login-tab__icon" />
                <span>{t.label}</span>
              </button>
            ))}

            {/* فاصل وسُمة مميزة لبند التقارير */}
            <div className="my-2 border-t border-slate-700/80 pt-2 col-span-full sm:col-span-1">
              <div className="text-[10px] font-black text-slate-400 mb-1.5 flex items-center gap-1 hidden sm:flex px-1">
                <FileSpreadsheet size={12} className="text-emerald-400" />
                <span>قسم التقارير والنتائج</span>
              </div>
              {/* أصناف bg-emerald-* من Tailwind كانت تخسر أمام .login-tab في
                  theme.css لتساوي النوعية وتأخّر استيراد theme، فلا يظهر
                  التفعيل الأخضر إطلاقاً. الحالة الآن من نظام الرموز. */}
              <button
                type="button"
                onClick={() => { setMode('reports'); setError(''); }}
                className={`login-tab login-tab--reports w-full flex items-center justify-between gap-2 px-3 py-2.5 transition-all cursor-pointer ${
                  mode === 'reports' ? 'login-tab--active' : ''
                }`}
              >
                <div className="flex items-center gap-2">
                  {/* لا text-emerald-400 هنا: skin.css يعرّفها بـ !important
                      فتبقى الأيقونة خضراء فوق الخلفية الخضراء عند التفعيل.
                      لونها في الحالتين يأتي من .login-tab--reports. */}
                  <FileSpreadsheet size={17} className="login-tab__icon" />
                  <span className="font-black text-xs">التقارير</span>
                </div>
              </button>
            </div>
          </nav>

        </aside>
      )}

      {/* ===================== البطاقة الرئيسية ===================== */}
      <div className={`bg-slate-800 rounded-3xl border border-slate-700 shadow-2xl overflow-hidden ${!showSidebar ? 'w-full' : ''}`}>
        <div className="ut-accent-bar" />

        <div className="p-4 md:p-8">
          <div className="mb-6 flex items-center justify-between border-b border-slate-700/60 pb-4">
            <div>
              <h2 className="text-white text-lg font-black flex items-center gap-2">
                {mode === 'reports' && <FileSpreadsheet className="text-emerald-400" size={20} />}
                {TABS.find(t => t.id === mode)?.label}
              </h2>
              <p className="text-slate-400 text-[11px] font-bold mt-1">
                {TABS.find(t => t.id === mode)?.desc}
              </p>
            </div>
            {mode === 'reports' && isReportsLoggedIn && (
              <button 
                type="button" 
                onClick={() => reportsLogoutRef.current?.()} 
                className="bg-red-950/60 hover:bg-red-900/80 text-red-300 border border-red-800/80 text-xs font-bold px-3.5 py-2 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer shadow-sm hover:border-red-500/80 shrink-0"
              >
                <LogOut size={15} className="text-red-400" />
                <span>تسجيل خروج</span>
              </button>
            )}
          </div>

          {mode === 'reports' ? (
            <div className="pt-2">
              <ScreenLoader>
                <LazyReportsView
                  syncUrl={adminConfig.syncUrl}
                  adminConfig={adminConfig}
                  onUpdateConfig={setAdminConfig}
                  logAction={logAction}
                  onLoginStateChange={setIsReportsLoggedIn}
                  onLogoutRef={reportsLogoutRef}
                />
              </ScreenLoader>
            </div>
          ) : (
            <>
              {!adminConfig.syncUrl && mode !== 'admin' && (
                <div className="mb-5 p-4 bg-blue-900/20 border-r-4 border-blue-500 rounded-xl">
                  <p className="text-blue-400 text-xs font-bold">جارٍ الاتصال بالخادم…</p>
                </div>
              )}

          {!navigator.onLine && (
            <div className="mb-4 p-3 bg-red-900/30 border border-red-500/50 rounded-2xl flex items-center gap-3 text-red-400 text-[11px] font-black">
              <WifiOff size={16} /> الهاتف غير متصل بالإنترنت
            </div>
          )}

          {notice && !error && (
            <div className="mb-4 p-4 bg-orange-900/20 border-r-4 border-orange-500 rounded-xl text-orange-300 text-xs font-bold flex gap-2 items-start">
              <Info size={16} className="shrink-0 mt-0.5" />
              <span>{notice}</span>
            </div>
          )}

          {mode === 'login' && (
            <p className="mb-4 text-[11px] text-slate-400 font-bold leading-relaxed">
              حسابك يُنشئه المسؤول. إن لم يكن لديك حساب بعد، تواصل معه ليُضيفك.
            </p>
          )}

          {error && (
            <div className="mb-4 p-4 bg-red-900/20 border-r-4 border-red-500 rounded-xl text-red-400 text-xs font-bold flex gap-2 items-start">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {isLoading && (
            <div className="mb-4 p-3 bg-blue-900/20 border border-blue-500/50 rounded-2xl flex items-center justify-center gap-2 text-blue-400 text-xs font-bold">
              <Loader2 className="animate-spin" size={16} /> {isSlow ? 'جارٍ الاتصال…' : 'جارٍ المعالجة والتحقق…'}
            </div>
          )}

          {/* ===== دخول الموظف ===== */}
          {mode === 'login' && (
            <form onSubmit={handleEmployeeLogin} className="space-y-4">
              <input type="text" placeholder="الرقم القومي" maxLength={14} inputMode="numeric" value={nationalId} onChange={e => setNationalId(e.target.value.replace(/\D/g, ''))} className={inputClasses} />
              <div className="relative">
                <input type={showLoginPassword ? 'text' : 'password'} placeholder="كلمة المرور" value={password} onChange={e => setPassword(e.target.value)} className={`${inputClasses} pl-12`} />
                <button type="button" onClick={() => setShowLoginPassword(!showLoginPassword)} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition-colors">
                  {showLoginPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              <button type="submit" disabled={isLoading} className="w-full bg-blue-600 text-white font-black py-4 rounded-2xl flex items-center justify-center gap-2 text-sm">
                <LogIn size={20} /> دخول
              </button>

              <button
                type="button"
                onClick={() => { setShowRecovery(true); setRecNationalId(nationalId.trim()); }}
                className="w-full text-center text-[11px] font-bold text-blue-400 py-2 rounded-xl cursor-pointer"
              >
                نسيت كلمة المرور؟
              </button>
            </form>
          )}

          {/* ===== استعادة كلمة المرور ===== */}
          {mode === 'login' && showRecovery && (
            <div className="mt-4 p-4 rounded-2xl border border-blue-500/40 bg-blue-950/25 space-y-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-white text-sm font-black flex items-center gap-2">
                    <KeyRound size={17} className="text-blue-400" />
                    استعادة كلمة المرور
                  </div>
                  <p className="text-[11px] text-slate-400 font-bold mt-1 leading-relaxed">
                    {recStep === 1
                      ? 'الاستعادة متاحة من هاتفك المسجّل فقط. إن كنت غيّرت هاتفك راجع المسؤول.'
                      : `تم التحقق من هويتك: ${recVerifiedName}`}
                  </p>
                </div>
                <button type="button" onClick={closeRecovery} className="text-slate-400 text-xs font-black px-2 py-1 rounded-lg cursor-pointer shrink-0">
                  إغلاق
                </button>
              </div>

              {recSuccess ? (
                <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-500/40 text-emerald-300 text-xs font-bold">
                  {recSuccess}
                </div>
              ) : recStep === 1 ? (
                <form onSubmit={handleRecoveryVerify} className="space-y-3">
                  <input
                    type="text" placeholder="الرقم القومي" maxLength={14} inputMode="numeric"
                    value={recNationalId}
                    onChange={e => setRecNationalId(e.target.value.replace(/\D/g, ''))}
                    className={inputClasses}
                  />
                  {recError && (
                    <div className="p-3 rounded-xl bg-red-950/40 border border-red-500/40 text-red-300 text-[11px] font-bold flex gap-2 items-start">
                      <AlertCircle size={15} className="shrink-0 mt-0.5" /><span>{recError}</span>
                    </div>
                  )}
                  <button type="submit" disabled={recLoading} className="w-full bg-blue-600 text-white font-black py-3 rounded-2xl flex items-center justify-center gap-2 text-xs">
                    {recLoading ? <Loader2 className="animate-spin" size={17} /> : <Smartphone size={17} />}
                    {recLoading ? 'جارٍ التحقق…' : 'تحقّق من هويتي'}
                  </button>
                </form>
              ) : (
                <form onSubmit={handleRecoverySubmit} className="space-y-3">
                  <div className="relative">
                    <input
                      type={recShowPass ? 'text' : 'password'} placeholder="كلمة المرور الجديدة" minLength={6}
                      value={recNewPass} onChange={e => setRecNewPass(e.target.value)}
                      className={`${inputClasses} pl-12`}
                    />
                    <button type="button" onClick={() => setRecShowPass(!recShowPass)} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 transition-colors">
                      {recShowPass ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                  <input
                    type={recShowPass ? 'text' : 'password'} placeholder="تأكيد كلمة المرور الجديدة" minLength={6}
                    value={recConfirmPass} onChange={e => setRecConfirmPass(e.target.value)}
                    className={inputClasses}
                  />
                  {recError && (
                    <div className="p-3 rounded-xl bg-red-950/40 border border-red-500/40 text-red-300 text-[11px] font-bold flex gap-2 items-start">
                      <AlertCircle size={15} className="shrink-0 mt-0.5" /><span>{recError}</span>
                    </div>
                  )}
                  {/* emerald-700: الأبيض على 600 يعطي 3.77:1 دون حدّ WCAG */}
                  <button type="submit" disabled={recLoading} className="w-full bg-emerald-700 text-white font-black py-3 rounded-2xl flex items-center justify-center gap-2 text-xs">
                    {recLoading ? <Loader2 className="animate-spin" size={17} /> : <KeyRound size={17} />}
                    {recLoading ? 'جارٍ الحفظ…' : 'تعيين كلمة المرور'}
                  </button>
                </form>
              )}
            </div>
          )}

          {/* ===== دخول المسؤول ===== */}
          {mode === 'admin' && (
            <form onSubmit={handleAdminSubmit} className="space-y-4">
              <input type="text" placeholder="اسم مستخدم المسؤول" value={adminUsername} onChange={e => setAdminUsername(e.target.value)} className={inputClasses} />
              <div className="relative">
                <input type={showAdminPassword ? 'text' : 'password'} placeholder="كلمة مرور المسؤول" value={adminPassword} onChange={e => setAdminPassword(e.target.value)} className={`${inputClasses} pl-12`} />
                <button type="button" onClick={() => setShowAdminPassword(!showAdminPassword)} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition-colors">
                  {showAdminPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              <button type="submit" disabled={isLoading} className="w-full bg-blue-600 text-white font-black py-4 rounded-2xl flex items-center justify-center gap-2">
                <ShieldAlert size={20} /> دخول لوحة التحكم
              </button>
            </form>
          )}
          </>
          )}
        </div>
      </div>
    </div>
  );
}
