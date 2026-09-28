
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { User, Branch, AppConfig, Job, ReportAccount, Customer, VisitReason, Visit } from './types';
import Login from './components/Login';
import UserDashboard from './components/UserDashboard';
import { LazyAdminDashboard, LazyReportsView, ScreenLoader } from './components/LazyScreens';
import { ShieldCheck, User as UserIcon, Cloud, CloudOff, RefreshCw, FileSpreadsheet, Home, Download, Share, PlusSquare, X, Wifi, LogOut, ShieldAlert, AlertTriangle, Smartphone, Settings } from 'lucide-react';
import { syncTimeWithServer, checkDeveloperOptionsStatus, getDeviceFingerprint } from './utils';
import { LogoMark } from './components/Logo';
import { postJson, SESSION_INVALID_CODES } from './api';

/**
 * ترحيل مفاتيح التخزين من بادئة `attendance_` إلى `cusfollow_`.
 *
 * البادئة القديمة من نظام الحضور الذي حلّ محلّه هذا التطبيق. تغييرها بلا
 * ترحيل كان يُخرج كل موظف من حسابه ويمحو إعداداته المحلية.
 *
 * يُنفَّذ عند استيراد الوحدة — أي **قبل** أن تقرأ أي حالة من localStorage.
 * ينسخ ولا يحذف: لو رجع المستخدم لنسخة أقدم من التطبيق لوجد بياناته.
 */
(function migrateLegacyStorageKeys() {
  try {
    ['config', 'branches', 'jobs', 'current_user'].forEach((k) => {
      const oldKey = 'attendance_' + k;
      const newKey = 'cusfollow_' + k;
      if (localStorage.getItem(newKey) === null) {
        const val = localStorage.getItem(oldKey);
        if (val !== null) localStorage.setItem(newKey, val);
      }
    });

    // نسخ قديمة كانت تحفظ على كل هاتف قائمة الموظفين كلها بكلمات مرورهم،
    // وحسابات التقارير بكلمات مرورها. لم يعد التطبيق يستقبلها أصلاً،
    // فتُمحى بقاياها من الأجهزة.
    ['users', 'report_accounts'].forEach((k) => {
      localStorage.removeItem('attendance_' + k);
      localStorage.removeItem('cusfollow_' + k);
    });
  } catch (e) {
    // تخزين محجوب أو ممتلئ — التطبيق يبدأ من الصفر ويعيد المزامنة
  }
})();

// ==========================================
// كلمة مرور المسؤول لم تعد مكتوبة هنا.
//
// كانت مشحونة في حزمة JS العلنية، فيقرؤها أي شخص يفتح مصدر الصفحة ثم
// يطلب بها كل البيانات. المرجع الوحيد الآن شيت Config في الخادم:
// المسؤول يكتبها عند الدخول، ويتحقّق منها الخادم، وتبقى في ذاكرة الجلسة
// (sessionStorage) حتى إغلاق نافذة المتصفح — لا في localStorage.
const ADMIN_SESSION_KEY = 'cusfollow_admin_session';

const readAdminSession = (): { username: string; password: string } | null => {
  try {
    const raw = sessionStorage.getItem(ADMIN_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && parsed.password ? parsed : null;
  } catch (e) {
    return null;
  }
};

/**
 * مهلة المزامنة العادية (فتح التطبيق · زر التحديث · عودة الاتصال).
 * بدونها تعلّق الشبكة الضعيفة — لا المنقطعة — الطلبَ بلا نهاية.
 */
const SYNC_TIMEOUT_MS = 30000;

/**
 * البيانات الأساسية المحفوظة على الهاتف (العملاء · الأسباب) ومعها رقم نسختها.
 *
 * كل مزامنة ترسل الرقم؛ إن لم تتغيّر البيانات على الخادم لم يُرسلها ثانيةً.
 * شبكة أمان: مزامنة كاملة إجبارية كل ١٢ ساعة، وبزر «تحديث»، وعند الدخول.
 */
const DATA_VERSION_KEY = 'cusfollow_data_version';
const DATA_OWNER_KEY = 'cusfollow_data_owner';
const FULL_SYNC_AT_KEY = 'cusfollow_full_sync_at';
const FULL_SYNC_EVERY_MS = 12 * 60 * 60 * 1000;

/** الرقم المحفوظ — يُرسل فقط إن كان لهذا المستخدم ولم يمضِ عليه ١٢ ساعة */
const readKnownDataVersion = (userId: string): string | undefined => {
  try {
    if (localStorage.getItem(DATA_OWNER_KEY) !== userId) return undefined;
    const at = Number(localStorage.getItem(FULL_SYNC_AT_KEY)) || 0;
    if (Date.now() - at > FULL_SYNC_EVERY_MS) return undefined;
    if (localStorage.getItem('uniteam_customers') === null) return undefined;
    const v = localStorage.getItem(DATA_VERSION_KEY);
    return v ? v : undefined;
  } catch (e) {
    return undefined;
  }
};

/**
 * الجلسة المحفوظة تُقرأ قبل أول رسم.
 * كانت تُقرأ بعده، فترتسم شاشة الدخول لحظة ثم تُستبدل بشاشة الموظف عند كل فتح.
 * جلسة المسؤول لا تُستعاد إلا وكلمة مروره في ذاكرة هذه النافذة.
 */
const readSavedUser = (): User | null => {
  try {
    const raw = localStorage.getItem('cusfollow_current_user');
    if (!raw) return null;
    const parsed: User = JSON.parse(raw);
    if (parsed.role === 'admin' && !readAdminSession()) {
      localStorage.removeItem('cusfollow_current_user');
      return null;
    }
    return parsed;
  } catch (e) {
    return null;
  }
};

/** قراءة JSON محفوظ بلا رمي استثناء */
const readJson = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch (e) {
    return fallback;
  }
};

/**
 * مهلة مزامنة التحقّق.
 *
 * تُستدعى بعد فشل غامض في أمر زيارة لتسأل الخادم ماذا حدث فعلاً.
 * قصيرة عمداً: الموظف ينتظر جواباً، ولو تأخّرت لصارت جزءاً من المشكلة
 * التي جاءت تحلّها.
 */
const VERIFY_SYNC_TIMEOUT_MS = 15000;
// ==========================================

const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<User | null>(() => readSavedUser());
  const [branches, setBranches] = useState<Branch[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [reportAccounts, setReportAccounts] = useState<ReportAccount[]>([]);
  const [allUsers, setAllUsers] = useState<User[]>([]);

  // ---------- متابعة العملاء ----------
  // قائمة العملاء والأسباب تُقرأ قبل أول رسم — الموظف يرى عملاءه فوراً
  const [customers, setCustomers] = useState<Customer[]>(() => readJson<Customer[]>('uniteam_customers', []));
  const [visitReasons, setVisitReasons] = useState<VisitReason[]>(() => readJson<VisitReason[]>('uniteam_visit_reasons', []));
  /** الزيارات المفتوحة على الخادم — شاشة الموظف تستعيد منها زيارته */
  const [openVisits, setOpenVisits] = useState<Visit[]>([]);
  /**
   * لحظة **بدء** الطلب الذي جاءت منه openVisits (لا لحظة وصوله).
   * شاشة الموظف تتجاهل أي لقطة بدأ طلبها قبل آخر أمر زيارة أرسلته —
   * فتلك لقطة لما قبل الأمر، وتطبيقها كان يُخفي الزيارة ثم يُظهرها.
   */
  const [openVisitsAsOf, setOpenVisitsAsOf] = useState<number | undefined>(undefined);
  const [customerRadius, setCustomerRadius] = useState<number>(100);
  /** رسالة تظهر في شاشة الدخول بعد إخراج المستخدم لسبب من الخادم */
  const [loginNotice, setLoginNotice] = useState('');

  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [activeView, setActiveView] = useState<'main' | 'reports'>('main');
  const [installPrompt, setInstallPrompt] = useState<any>(null);

  // ---------- تحديث التطبيق الأصلي ----------
  const [apkUpdate, setApkUpdate] = useState<{
    available: boolean; url: string; versionName: string; notes: string; mandatory: boolean;
  }>({ available: false, url: '', versionName: '', notes: '', mandatory: false });

  const [updateState, setUpdateState] = useState<{
    phase: 'idle' | 'downloading' | 'installing' | 'permission' | 'error';
    percent: number; message: string;
  }>({ phase: 'idle', percent: 0, message: '' });
  
  // iOS Installation States
  const [isIos, setIsIos] = useState(false);
  const [isInStandaloneMode, setIsInStandaloneMode] = useState(false);
  const [showIosInstructions, setShowIosInstructions] = useState(false);

  // Developer Options Security Detection
  const [developerModeStatus, setDeveloperModeStatus] = useState<{ enabled: boolean; source: string }>({ enabled: false, source: '' });

  // مفتاح الصيانة: يُقرأ من server-config.json ليمكن إيقاف التطبيق
  // عن الموظفين أثناء التحديث دون إيقاف نشر الموقع
  const [maintenance, setMaintenance] = useState<{ active: boolean; title: string; message: string }>({
    active: false,
    title: 'التطبيق تحت الصيانة',
    message: 'يجري تحديث النظام حالياً. حاول مرة أخرى بعد قليل.'
  });

  useEffect(() => {
    const checkDevMode = () => {
      const status = checkDeveloperOptionsStatus();
      setDeveloperModeStatus(status);
    };
    checkDevMode();
    const interval = setInterval(checkDevMode, 3000);
    return () => clearInterval(interval);
  }, []);

  const [config, setConfig] = useState<AppConfig>(() => {
    const saved = localStorage.getItem('cusfollow_config');
    const session = readAdminSession();
    const defaultConfig: AppConfig = {
      googleSheetLink: '',
      syncUrl: '',
      auditLogUrl: '',
      adminUsername: 'admin',
      adminPassword: ''
    };
    let cfg = defaultConfig;
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // كلمة مرور محفوظة من نسخة قديمة لا يُعتدّ بها
        cfg = { ...defaultConfig, ...parsed, adminPassword: '' };
      } catch (e) {
        cfg = defaultConfig;
      }
    }
    if (session) cfg = { ...cfg, adminUsername: session.username, adminPassword: session.password };
    return cfg;
  });

  // مراجع تقرؤها المزامنة وقت التنفيذ — فتبقى دالتها ثابتة لا تُعاد صناعتها
  // مع كل تغيّر في الحالة. إعادة صناعتها كانت تُطلق التأثيرات المعتمدة عليها.
  const currentUserRef = useRef<User | null>(currentUser);
  const configRef = useRef<AppConfig>(config);
  const syncSeqRef = useRef(0);
  useEffect(() => { configRef.current = config; }, [config]);
  useEffect(() => { currentUserRef.current = currentUser; }, [currentUser]);

  useEffect(() => {
    // Android Install Prompt
    // المستمع مُسمّى ليُزال في التنظيف — كان يُضاف مجهولاً ويبقى معلّقاً
    const handleInstallPrompt = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handleInstallPrompt);

    // Detect iOS
    const userAgent = window.navigator.userAgent.toLowerCase();
    const isIosDevice = /iphone|ipad|ipod/.test(userAgent);
    setIsIos(isIosDevice);

    // Detect Standalone Mode (Installed)
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone === true;
    setIsInStandaloneMode(isStandalone);
    
    // Online/Offline Status Listeners
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleInstallPrompt);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const handleInstallClick = () => {
    if (installPrompt) {
      installPrompt.prompt();
      installPrompt.userChoice.then((choiceResult: any) => {
        if (choiceResult.outcome === 'accepted') {
          setInstallPrompt(null);
        }
      });
    } else if (isIos) {
      setShowIosInstructions(true);
    }
  };

  /** يطبّق بيانات الموظف القادمة من الخادم (login أو getMyData) */
  const applyEmployeeData = useCallback((data: any, requestStartedAt: number, url?: string) => {
    // ردّ كامل (لا «بلا تغيير»): تُحفظ البيانات مع رقم نسختها ولحظة المزامنة الكاملة
    if (!data.unchanged && Array.isArray(data.customers)) {
      try {
        localStorage.setItem(DATA_VERSION_KEY, data.dataVersion ? String(data.dataVersion) : '');
        localStorage.setItem(DATA_OWNER_KEY, data.user && data.user.id ? String(data.user.id) : '');
        localStorage.setItem(FULL_SYNC_AT_KEY, String(Date.now()));
      } catch (e) {}
    }
    if (Array.isArray(data.customers)) {
      setCustomers(data.customers);
      try { localStorage.setItem('uniteam_customers', JSON.stringify(data.customers)); } catch (e) {}
    }
    if (Array.isArray(data.visitReasons)) {
      setVisitReasons(data.visitReasons);
      try { localStorage.setItem('uniteam_visit_reasons', JSON.stringify(data.visitReasons)); } catch (e) {}
    }
    // الزيارات المفتوحة لا تُخزَّن محلياً: الخادم وحده مرجعها
    if (Array.isArray(data.openVisits)) {
      setOpenVisits(data.openVisits);
      setOpenVisitsAsOf(requestStartedAt);
    }
    if (data.customerRadius && !isNaN(Number(data.customerRadius))) {
      setCustomerRadius(Number(data.customerRadius));
    }
    if (data.user && data.user.id) {
      // لا يُستبدل الكائن إلا إن تغيّر فعلاً. كان يُستبدل مع كل مزامنة،
      // وكان تأثير المزامنة معتمداً عليه فيُطلق مزامنة جديدة — حلقة لا تتوقف.
      const prev = currentUserRef.current;
      const next: User = { ...data.user, role: 'employee' };
      if (!prev || JSON.stringify(prev) !== JSON.stringify(next)) {
        currentUserRef.current = next;
        setCurrentUser(next);
        try { localStorage.setItem('cusfollow_current_user', JSON.stringify(next)); } catch (e) {}
      }
    }
    setConfig(prev => {
      const updated: AppConfig = { ...prev, lastUpdated: new Date().toISOString() };
      if (url) { updated.syncUrl = url; updated.googleSheetLink = url; }
      if (data.customerRadius && !isNaN(Number(data.customerRadius))) {
        updated.defaultCustomerRadius = Number(data.customerRadius);
      }
      const { adminPassword, ...configToSave } = updated;
      try { localStorage.setItem('cusfollow_config', JSON.stringify(configToSave)); } catch (e) {}
      return updated;
    });
  }, []);

  /** يطبّق بيانات لوحة الإدارة (getAdminData) */
  const applyAdminData = useCallback((data: any, requestStartedAt: number, url?: string) => {
    if (Array.isArray(data.branches)) setBranches(data.branches);
    if (Array.isArray(data.jobs)) setJobs(data.jobs);
    // الموظفون وحسابات التقارير تحمل كلمات مرور — تبقى في الذاكرة ولا تُحفظ
    if (Array.isArray(data.users)) setAllUsers(data.users);
    if (Array.isArray(data.reportAccounts)) setReportAccounts(data.reportAccounts);
    if (Array.isArray(data.customers)) setCustomers(data.customers);
    if (Array.isArray(data.visitReasons)) setVisitReasons(data.visitReasons);
    if (Array.isArray(data.openVisits)) {
      setOpenVisits(data.openVisits);
      setOpenVisitsAsOf(requestStartedAt);
    }
    if (data.customerRadius && !isNaN(Number(data.customerRadius))) {
      setCustomerRadius(Number(data.customerRadius));
    }
    setConfig(prev => {
      const updated: AppConfig = { ...prev, lastUpdated: new Date().toISOString() };
      if (url) { updated.syncUrl = url; updated.googleSheetLink = url; }
      if (data.customerRadius && !isNaN(Number(data.customerRadius))) {
        updated.defaultCustomerRadius = Number(data.customerRadius);
      }
      const { adminPassword, ...configToSave } = updated;
      try { localStorage.setItem('cusfollow_config', JSON.stringify(configToSave)); } catch (e) {}
      return updated;
    });
  }, []);

  /** إخراج المستخدم إلى شاشة الدخول مع سبب يراه */
  const forceLogout = useCallback((notice: string) => {
    try {
      localStorage.removeItem('cusfollow_current_user');
      sessionStorage.removeItem(ADMIN_SESSION_KEY);
    } catch (e) {}
    currentUserRef.current = null;
    setCurrentUser(null);
    setAllUsers([]);
    setReportAccounts([]);
    setConfig(prev => ({ ...prev, adminPassword: '' }));
    setActiveView('main');
    setLoginNotice(notice);
  }, []);

  /**
   * مزامنة بيانات المستخدم الحالي من الخادم.
   *
   * الموظف يطلب getMyData بهويته فيصله سجلّه وعملاء توكيله وزيارته
   * المفتوحة فقط. المسؤول يطلب getAdminData بكلمة مروره. بلا مستخدم
   * مسجَّل لا مزامنة أصلاً — لا شيء يُسلَّم لمجهول.
   *
   * **تُعيد البيانات** (أو null عند أي تعذّر) — شاشة الموظف تحتاجها فوراً
   * بعد فشل غامض لتسأل الخادم عن حال زيارتها.
   *
   * @param timeoutMs  مهلة الطلب
   * @param urlOverride رابط بديل (رابط جديد من server-config.json مثلاً)
   */
  const syncWithCloud = useCallback(async (
    timeoutMs: number = SYNC_TIMEOUT_MS,
    urlOverride?: string,
    full: boolean = false
  ): Promise<any | null> => {
    const url = urlOverride || configRef.current.syncUrl;
    const user = currentUserRef.current;
    if (!url || !url.startsWith('http') || !user) return null;
    if (!navigator.onLine) {
      setSyncError(true);
      return null;
    }

    const seq = ++syncSeqRef.current;
    const startedAt = Date.now();
    setIsSyncing(true);
    setSyncError(false);

    try {
      const payload = user.role === 'admin'
        ? {
            action: 'getAdminData',
            adminUsername: configRef.current.adminUsername,
            adminPassword: configRef.current.adminPassword
          }
        : {
            action: 'getMyData',
            nationalId: user.nationalId,
            password: user.password,
            deviceId: getDeviceFingerprint(),
            // إن لم تتغيّر البيانات على الخادم لم يُرسلها ثانيةً
            knownVersion: full ? undefined : readKnownDataVersion(user.id)
          };

      const data = await postJson(url, payload, timeoutMs);

      // خرج المستخدم أو تبدّل أثناء الطلب — الردّ لم يعد يخصّ أحداً
      const now = currentUserRef.current;
      if (!now || now.id !== user.id || now.role !== user.role) return null;

      if (!data || data.status !== 'ok') {
        setSyncError(true);
        if (data && SESSION_INVALID_CODES.includes(data.code)) {
          forceLogout(data.message || 'انتهت صلاحية الدخول. سجّل الدخول من جديد.');
        }
        return null;
      }

      // طلب أحدث بدأ بعد هذا — نتيجته هي المرجع، فلا نطبّق هذه فوقها.
      // لكنها تُعاد لمن طلبها: جوابها صحيح للحظة التي سأل فيها.
      if (seq === syncSeqRef.current) {
        if (user.role === 'admin') applyAdminData(data, startedAt, url);
        else applyEmployeeData(data, startedAt, url);
      }
      return data;
    } catch (err) {
      setSyncError(true);
      if ((err as any)?.name === 'AbortError') {
        console.warn('Sync timed out after', timeoutMs, 'ms');
      } else {
        console.warn('Sync attempt failed:', err);
      }
      return null;
    } finally {
      if (seq === syncSeqRef.current) setIsSyncing(false);
    }
  }, [applyAdminData, applyEmployeeData, forceLogout]);

  // التحميل الأول
  useEffect(() => {
    // مزامنة الوقت تتم من ردّ server-config.json الذي يُطلب عند الفتح أصلاً
    // (انظر checkForUpdates) — لا طلب منفصل لها.

    const savedBranches = localStorage.getItem('cusfollow_branches');
    const savedJobs = localStorage.getItem('cusfollow_jobs');
    try {
      if (savedBranches) setBranches(JSON.parse(savedBranches));
      if (savedJobs) setJobs(JSON.parse(savedJobs));
    } catch (e) {}

    // الجلسة والعملاء قُرئت قبل أول رسم (قيم useState الابتدائية)
    const restored = currentUserRef.current;

    // رابط الخادم ممرَّر في الرابط (?c=...)
    const params = new URLSearchParams(window.location.search);
    const cloudUrlEncoded = params.get('c');
    let urlToSync = config.syncUrl;

    if (cloudUrlEncoded) {
      try {
        const decodedUrl = atob(cloudUrlEncoded);
        if (decodedUrl.startsWith('http')) {
          urlToSync = decodedUrl;
          window.history.replaceState({}, document.title, window.location.pathname);
          setConfig(prev => {
            const updated = { ...prev, syncUrl: decodedUrl, googleSheetLink: decodedUrl };
            const { adminPassword, ...configToSave } = updated;
            try { localStorage.setItem('cusfollow_config', JSON.stringify(configToSave)); } catch (e) {}
            return updated;
          });
        }
      } catch (e) {}
    }

    // مزامنة واحدة عند الفتح — لمن سجّل دخوله فقط
    if (urlToSync && restored) {
      syncWithCloud(SYNC_TIMEOUT_MS, urlToSync);
    }
  }, []);

  /**
   * مزامنة واحدة عند **عودة** الاتصال بعد انقطاعه — للموظف فقط.
   *
   * لا مزامنة دورية بعد اليوم. كانت هنا مزامنة كل خمس دقائق، وتأثير يعتمد
   * على currentUser — والمزامنة نفسها تستبدل currentUser بنسخة جديدة،
   * فيُطلق التأثير مزامنة أخرى فوراً: حلقة لا تتوقف ما دام الموظف داخلاً.
   * هي التي كانت تُظهر «مزامنة» أعلى الشاشة بلا انقطاع وتُثقل التطبيق
   * والخادم معاً، وتُخفي الزيارة المفتوحة ثم تُظهرها.
   *
   * البيانات تُحدَّث الآن: عند فتح التطبيق · بعد الدخول · بزر «تحديث» ·
   * بعد كل أمر زيارة · وعند عودة الاتصال. كل فحوص الأمان في الخادم
   * (الجهاز · الموقع · التكرار) تعمل عند كل أمر زيارة ولا علاقة لها بالمزامنة.
   */
  const wasOnlineRef = useRef(navigator.onLine);
  useEffect(() => {
    const cameBack = isOnline && !wasOnlineRef.current;
    wasOnlineRef.current = isOnline;
    if (cameBack && currentUserRef.current?.role === 'employee') {
      syncWithCloud();
    }
  }, [isOnline, syncWithCloud]);

  // Check for global updates from GitHub static file
  // تفعيل فوري لشاشة الصيانة حين تكتشفها شاشة الموظف لحظة الضغط على
  // فتح زيارة أو إغلاقها، دون انتظار دورة الفحص التالية
  useEffect(() => {
    const onMaintenance = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      setMaintenance({
        active: true,
        title: detail.title || 'التطبيق تحت الصيانة',
        message: detail.message || 'يجري تحديث النظام حالياً. حاول مرة أخرى بعد قليل.'
      });
    };
    window.addEventListener('uniteam:maintenance', onMaintenance);
    return () => window.removeEventListener('uniteam:maintenance', onMaintenance);
  }, []);

  /**
   * فحص توفّر تحديث للتطبيق الأصلي.
   *
   * يعمل داخل الـAPK وحده — النسخة المتصفحية تُحدَّث تلقائياً بنشر Pages
   * فلا معنى لعرض زر تحديث فيها.
   *
   * المقارنة بـ versionCode لا versionName: الأول عدد صحيح متزايد فالمقارنة
   * به قاطعة، أما "3.0.9" و"3.0.10" فترتيبهما النصّي مضلّل.
   */
  const checkApkUpdate = (data: any) => {
    const bridge = (window as any).AndroidBridge;
    if (!bridge || typeof bridge.getAppVersionCode !== 'function') return;
    if (!data || !data.apkUrl || typeof data.apkUrl !== 'string') return;

    try {
      const installed = Number(bridge.getAppVersionCode()) || 0;
      const latest = Number(data.latestVersionCode) || 0;
      if (latest > installed) {
        setApkUpdate({
          available: true,
          url: data.apkUrl,
          versionName: data.latestVersionName || '',
          notes: data.updateNotes || '',
          mandatory: data.updateMandatory === true
        });
      }
    } catch (e) {
      console.warn('APK update check failed', e);
    }
  };

  /** يبدأ التنزيل والتثبيت، بعد التأكد من إذن تثبيت الحزم */
  const startApkUpdate = () => {
    const bridge = (window as any).AndroidBridge;
    if (!bridge || typeof bridge.downloadAndInstallApk !== 'function') return;

    // أندرويد 8+ يشترط إذناً لكل تطبيق على حدة قبل فتح المثبّت
    if (typeof bridge.canInstallApk === 'function' && !bridge.canInstallApk()) {
      setUpdateState({ phase: 'permission', percent: 0, message: '' });
      if (typeof bridge.openInstallPermissionSettings === 'function') {
        bridge.openInstallPermissionSettings();
      }
      return;
    }

    setUpdateState({ phase: 'downloading', percent: 0, message: '' });
    logAction('بدء تحديث التطبيق', `النسخة: ${apkUpdate.versionName}`);
    bridge.downloadAndInstallApk(apkUpdate.url);
  };

  // الجسر ينادي هذه الدالة من جافا ليبلّغ الصفحة بتقدّم التنزيل
  useEffect(() => {
    (window as any).onApkUpdateState = (state: string, detail: string) => {
      if (state === 'progress') {
        setUpdateState({ phase: 'downloading', percent: parseInt(detail) || 0, message: '' });
      } else if (state === 'installing') {
        setUpdateState({ phase: 'installing', percent: 100, message: '' });
      } else if (state === 'error') {
        setUpdateState({ phase: 'error', percent: 0, message: detail });
        logAction('فشل تحديث التطبيق', detail);
      } else if (state === 'start') {
        setUpdateState({ phase: 'downloading', percent: 0, message: '' });
      }
    };
    return () => { delete (window as any).onApkUpdateState; };
  }, []);

  useEffect(() => {
    const checkForUpdates = async () => {
      if (!navigator.onLine) return;
      try {
        const startTime = performance.now();
        const res = await fetch('./server-config.json?t=' + Date.now());
        // ساعة التطبيق تُضبط من تاريخ هذا الردّ نفسه — طلب واحد بدل ثلاثة
        syncTimeWithServer({ res, startTime }).catch(e => console.warn('Time sync failed', e));
        if (res.ok) {
          const data = await res.json();

          // مفتاح الصيانة يُقرأ قبل أي شيء آخر، فهو يحجب الواجهة كاملة
          setMaintenance({
            active: data && data.maintenance === true,
            title: (data && data.maintenanceTitle) || 'التطبيق تحت الصيانة',
            message: (data && data.maintenanceMessage) ||
                     'يجري تحديث النظام حالياً. حاول مرة أخرى بعد قليل.'
          });

          checkApkUpdate(data);

          if (data && data.googleSheetLink && data.googleSheetLink.startsWith('http')) {
            const saved = localStorage.getItem('cusfollow_config');
            const currentConfig = saved ? JSON.parse(saved) : null;
            
            const hasChanges = !currentConfig || 
                              data.googleSheetLink !== currentConfig.syncUrl || 
                              (data.auditLogUrl !== undefined && data.auditLogUrl !== currentConfig.auditLogUrl);

            if (hasChanges) {
              setConfig(prev => {
                const updatedConfig = { 
                  ...prev, 
                  syncUrl: data.googleSheetLink, 
                  googleSheetLink: data.googleSheetLink,
                  auditLogUrl: data.auditLogUrl !== undefined ? data.auditLogUrl : prev.auditLogUrl
                };
                const { adminPassword, ...configToSave } = updatedConfig;
                localStorage.setItem('cusfollow_config', JSON.stringify(configToSave));
                return updatedConfig;
              });
              syncWithCloud(SYNC_TIMEOUT_MS, data.googleSheetLink);
            }
          }
        }
      } catch (e) {
        // Ignore errors
      }
    };

    checkForUpdates();
    const interval = setInterval(checkForUpdates, 5 * 60000); // Check every 5 minutes
    return () => clearInterval(interval);
  }, [syncWithCloud]);

  useEffect(() => { localStorage.setItem('cusfollow_branches', JSON.stringify(branches)); }, [branches]);
  useEffect(() => { localStorage.setItem('cusfollow_jobs', JSON.stringify(jobs)); }, [jobs]);

  const logAction = useCallback(async (action: string, details: string = '') => {
    if (!config.syncUrl || !navigator.onLine) return;
    
    try {
      const payload = {
        action: 'logAudit',
        user: currentUser ? `${currentUser.fullName} (${currentUser.role})` : 'Guest',
        auditAction: action,
        details: details,
        deviceInfo: navigator.userAgent,
        spreadsheetId: config.auditLogUrl || ''
      };
      
      await fetch(config.syncUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch (e) {
      console.error('Audit Log Error:', e);
    }
  }, [config.syncUrl, config.auditLogUrl, currentUser]);

  /**
   * دخول ناجح تحقّق منه الخادم.
   *
   * @param data   ردّ الخادم نفسه (login أو getAdminData) — يُطبَّق فوراً
   *               فلا حاجة لطلب ثانٍ بعد الدخول
   * @param admin  بيانات المسؤول — تُحفظ في ذاكرة هذه النافذة فقط
   */
  const handleLogin = (
    user: User,
    data: any,
    requestStartedAt: number,
    admin?: { username: string; password: string }
  ) => {
    setLoginNotice('');
    // طلب قديم ما زال في الطريق لا يُطبَّق فوق بيانات الدخول
    syncSeqRef.current++;
    setIsSyncing(false);

    if (user.role === 'admin' && admin) {
      try { sessionStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify(admin)); } catch (e) {}
      const nextConfig = { ...configRef.current, adminUsername: admin.username, adminPassword: admin.password };
      configRef.current = nextConfig;
      setConfig(nextConfig);
    }

    currentUserRef.current = user;
    setCurrentUser(user);
    try { localStorage.setItem('cusfollow_current_user', JSON.stringify(user)); } catch (e) {}

    if (data) {
      if (user.role === 'admin') applyAdminData(data, requestStartedAt);
      else applyEmployeeData(data, requestStartedAt);
    }
  };

  const handleLogout = () => {
    if (currentUser) {
      logAction('تسجيل خروج', `المستخدم: ${currentUser.fullName} (${currentUser.role})`);
    }
    syncSeqRef.current++;
    setIsSyncing(false);
    try {
      localStorage.removeItem('cusfollow_current_user');
      sessionStorage.removeItem(ADMIN_SESSION_KEY);
    } catch (e) {}
    currentUserRef.current = null;
    setCurrentUser(null);
    setAllUsers([]);
    setReportAccounts([]);
    setOpenVisits([]);
    setOpenVisitsAsOf(undefined);
    setConfig(prev => ({ ...prev, adminPassword: '' }));
    setActiveView('main');
  };

  const handleUpdateConfig = (newCfg: Partial<AppConfig>) => {
    // كلمة مرور المسؤول لا تُغيَّر من هنا ولا تُحفظ على القرص
    const cfg = { ...config, ...newCfg, adminPassword: config.adminPassword };
    setConfig(cfg);
    const { adminPassword, ...configToSave } = cfg;
    localStorage.setItem('cusfollow_config', JSON.stringify(configToSave));
  };

  // Determine if we should show an install button (Android or iOS web)
  const showInstallButton = !isInStandaloneMode && (installPrompt || isIos);

  // شاشة الصيانة تحجب الواجهة كاملة، وتُفعَّل بتغيير حقل واحد
  // في server-config.json دون الحاجة لإيقاف نشر الموقع
  if (maintenance.active) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 md:p-6 bg-slate-900 relative z-10">
        <div className="w-full max-w-sm text-center">
          <div className="inline-flex items-center justify-center w-24 h-24 rounded-3xl bg-slate-800 border border-slate-700 mb-7">
            <Settings size={44} className="text-amber-500 animate-spin" style={{ animationDuration: '4s' }} />
          </div>

          <h1 className="text-xl font-black text-slate-100 mb-3">{maintenance.title}</h1>
          <p className="text-slate-400 text-sm leading-loose mb-8">{maintenance.message}</p>

          <button
            onClick={() => window.location.reload()}
            className="w-full bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-bold py-4 rounded-2xl transition-colors"
          >
            إعادة المحاولة
          </button>

          <div className="mt-6 text-xs text-slate-500 flex items-center justify-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-500"></span>
            <span>سيعود التطبيق تلقائياً عند انتهاء الصيانة</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col relative z-10">
      <header className="ut-header sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between relative">
          <div className="flex items-center gap-3">
            <LogoMark size={38} />
            <div className="leading-none">
              <div className="flex items-center gap-2">
                <h1 className="ut-brand" style={{ fontSize: 19 }}>Cust Follow</h1>
                {isSyncing ? (
                  <span className="ut-chip ut-chip--brand">
                    <RefreshCw size={11} className="animate-spin" /> مزامنة
                  </span>
                ) : isOnline && config.syncUrl ? (
                  currentUser?.role === 'admin' ? (
                    <span className="ut-chip ut-chip--warn">مزامنة يدوية</span>
                  ) : (
                    <span className="ut-chip ut-chip--ok">
                      <span className="ut-pulse" /> متصل
                    </span>
                  )
                ) : (
                  <span className="ut-chip ut-chip--bad">
                    <CloudOff size={11} /> غير متصل
                  </span>
                )}
              </div>
              <p className="ut-header__sub text-[11px] mt-1">
                {currentUser ? currentUser.fullName : 'متابعة العملاء'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {config.syncUrl && currentUser && (
              <button
                onClick={() => {
                  // زر «تحديث» مزامنة كاملة دائماً — لا يعتمد على رقم النسخة
                  syncWithCloud(SYNC_TIMEOUT_MS, undefined, true);
                  logAction('تحديث البيانات', 'مزامنة يدوية من الهيدر');
                }}
                disabled={isSyncing}
                title="تحديث البيانات"
                className="ut-btn ut-btn--brand"
              >
                <RefreshCw size={14} className={isSyncing ? 'animate-spin' : ''} />
                <span className="hidden sm:inline">تحديث</span>
              </button>
            )}

            {showInstallButton && (
              <button onClick={handleInstallClick} className="ut-btn ut-install hidden md:flex">
                <Download size={14} /> {isIos ? 'تثبيت على الآيفون' : 'تثبيت التطبيق'}
              </button>
            )}

            {/* الدخول للتقارير من القائمة الجانبية، والخروج منها من هنا.
                لا تظهر أزرار تنقّل في الترويسة إلا داخل التقارير. */}
            {!currentUser && activeView === 'reports' && (
              <button
                onClick={() => setActiveView('main')}
                className="ut-btn ut-btn--glass"
                style={{ height: 32, padding: '0 12px', fontSize: 12 }}
              >
                <Home size={14} />
                <span className="hidden sm:inline">العودة لتسجيل الدخول</span>
                <span className="sm:hidden">رجوع</span>
              </button>
            )}

            {currentUser && (
              <button
                onClick={handleLogout}
                className="ut-btn"
                style={{
                  background: 'rgba(239,68,68,.14)',
                  color: '#FCA5A5',
                  border: '1px solid rgba(239,68,68,.28)'
                }}
              >
                <LogOut size={14} />
                <span className="hidden sm:inline">خروج</span>
              </button>
            )}
          </div>
        </div>

        <div className="ut-accent-bar" />

        {!isOnline && (
          <div
            className="text-white text-[11px] font-bold py-1.5 text-center"
            style={{ background: 'var(--grad-bad)' }}
          >
            لا يوجد اتصال بالإنترنت — يعمل التطبيق في الوضع غير المتصل
          </div>
        )}

        {showInstallButton && (
          <button
            onClick={handleInstallClick}
            className="ut-install md:hidden w-full text-white py-3.5 min-h-[44px] text-sm font-bold flex justify-center items-center gap-2"
            style={{ borderRadius: 0 }}
          >
            <Download size={16} /> {isIos ? 'تثبيت Cust Follow على الآيفون' : 'تثبيت Cust Follow على هاتفك'}
          </button>
        )}

        {/* ===== شريط تحديث التطبيق — داخل الـAPK فقط ===== */}
        {apkUpdate.available && (
          <div className="w-full bg-emerald-950/90 border-t border-emerald-500/40 px-4 py-3">
            <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-emerald-300 text-xs font-black flex items-center gap-2">
                  <Download size={15} className="shrink-0" />
                  <span>
                    تحديث جديد متاح
                    {apkUpdate.versionName && ` — نسخة ${apkUpdate.versionName}`}
                  </span>
                </div>
                {apkUpdate.notes && (
                  <p className="text-[11px] text-emerald-200/70 font-bold mt-1 truncate">
                    {apkUpdate.notes}
                  </p>
                )}
                {updateState.phase === 'permission' && (
                  <p className="text-[11px] text-amber-300 font-bold mt-1">
                    فعّل «السماح بتثبيت التطبيقات» من الشاشة التي فُتحت، ثم اضغط تحديث مجدداً.
                  </p>
                )}
                {updateState.phase === 'error' && (
                  <p className="text-[11px] text-red-300 font-bold mt-1">{updateState.message}</p>
                )}
                {updateState.phase === 'installing' && (
                  <p className="text-[11px] text-emerald-200 font-bold mt-1">
                    اكتمل التنزيل — أكمل التثبيت من شاشة النظام.
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {updateState.phase === 'downloading' ? (
                  <div className="flex items-center gap-2 min-w-[130px]">
                    <div className="flex-1 h-2 rounded-full bg-emerald-950 border border-emerald-800 overflow-hidden">
                      <div
                        className="h-full bg-emerald-400 transition-all duration-200"
                        style={{ width: `${updateState.percent}%` }}
                      />
                    </div>
                    <span className="text-[11px] font-black text-emerald-300" style={{ direction: 'ltr' }}>
                      {updateState.percent}%
                    </span>
                  </div>
                ) : (
                  // emerald-700 لا 600: الأبيض على #059669 يعطي 3.77:1 وهو
                  // دون حدّ WCAG (4.5:1)، ويختفي عملياً تحت شمس الإسكندرية.
                  // #047857 يرفعه إلى 5.48:1.
                  <button
                    onClick={startApkUpdate}
                    className="bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-black px-4 py-2 rounded-xl cursor-pointer transition-all active:scale-95 min-h-[40px]"
                  >
                    {updateState.phase === 'error' ? 'إعادة المحاولة' : 'تحديث الآن'}
                  </button>
                )}

                {!apkUpdate.mandatory && updateState.phase === 'idle' && (
                  <button
                    onClick={() => setApkUpdate(prev => ({ ...prev, available: false }))}
                    className="text-emerald-400/70 text-[11px] font-bold px-2 py-2 cursor-pointer"
                  >
                    لاحقاً
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </header>

      <main className={`flex-1 w-full mx-auto pb-24 ${currentUser?.role === 'admin' ? 'admin-wide py-4 md:py-6' : 'max-w-6xl p-4 md:p-6'}`}>
        {activeView === 'reports' && !currentUser ? (
          <ScreenLoader>
            <LazyReportsView syncUrl={config.syncUrl} adminConfig={config} onUpdateConfig={handleUpdateConfig} logAction={logAction} />
          </ScreenLoader>
        ) : (
          !currentUser ? (
            <Login
              onLogin={handleLogin}
              adminConfig={config}
              setAdminConfig={handleUpdateConfig}
              logAction={logAction}
              onOpenReports={() => setActiveView('reports')}
              notice={loginNotice}
            />
          ) : (
            currentUser.role === 'admin' ? (
              <ScreenLoader>
                <LazyAdminDashboard
                  branches={branches} setBranches={setBranches} jobs={jobs} setJobs={setJobs}
                  config={config} setConfig={setConfig} allUsers={allUsers} setAllUsers={setAllUsers}
                  reportAccounts={reportAccounts} setReportAccounts={setReportAccounts}
                  customers={customers} setCustomers={setCustomers}
                  onRefresh={() => syncWithCloud()} isSyncing={isSyncing}
                  logAction={logAction}
                />
              </ScreenLoader>
            ) : (
              <UserDashboard
                user={currentUser}
                customers={customers}
                visitReasons={visitReasons}
                openVisits={openVisits}
                customerRadius={customerRadius}
                googleSheetLink={config.googleSheetLink}
                onRefresh={() => syncWithCloud(VERIFY_SYNC_TIMEOUT_MS)}
                isSyncing={isSyncing} lastUpdated={config.lastUpdated}
                openVisitsAsOf={openVisitsAsOf}
                logAction={logAction}
              />
            )
          )
        )}
      </main>
      
      <footer className="py-4 text-center relative z-10 text-slate-500 text-[10px] font-bold pb-6">
        <p>Cust Follow &copy; 2026</p>
        <p className="mt-0.5 opacity-70">RTM Team - Bahaa Mohamed-Tel: 01095665450</p>
      </footer>

      {/* iOS Installation Instructions Modal */}
      {showIosInstructions && (
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-end md:items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 w-full max-w-sm rounded-3xl p-4 md:p-6 relative animate-in slide-in-from-bottom-10 duration-300">
            <button 
              onClick={() => setShowIosInstructions(false)}
              className="absolute left-4 top-4 text-slate-400 hover:text-white"
            >
              <X size={24} />
            </button>
            <div className="text-center space-y-4 pt-4">
              <div className="bg-blue-600 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto shadow-lg shadow-blue-900/30">
                <Download size={32} className="text-white" />
              </div>
              <h3 className="text-xl font-black text-white">تثبيت التطبيق على الآيفون</h3>
              <p className="text-slate-400 text-xs font-bold leading-relaxed">
                نظراً لسياسات آبل، يرجى اتباع الخطوات التالية يدوياً لتثبيت التطبيق:
              </p>
              <div className="space-y-3 bg-slate-800/50 p-4 rounded-2xl border border-slate-700/50 text-right">
                <div className="flex items-center gap-3 text-white text-sm font-bold">
                  <span className="bg-slate-700 w-6 h-6 rounded-full flex items-center justify-center text-[10px]">1</span>
                  <span>اضغط على زر المشاركة في الأسفل</span>
                  <Share size={18} className="mr-auto text-blue-400" />
                </div>
                <div className="w-full h-px bg-slate-700/50"></div>
                <div className="flex items-center gap-3 text-white text-sm font-bold">
                  <span className="bg-slate-700 w-6 h-6 rounded-full flex items-center justify-center text-[10px]">2</span>
                  <span>اختر "إضافة إلى الصفحة الرئيسية"</span>
                  <PlusSquare size={18} className="mr-auto text-blue-400" />
                </div>
                <div className="w-full h-px bg-slate-700/50"></div>
                <div className="flex items-center gap-3 text-white text-sm font-bold">
                  <span className="bg-slate-700 w-6 h-6 rounded-full flex items-center justify-center text-[10px]">3</span>
                  <span>اضغط على "إضافة" (Add) في الأعلى</span>
                </div>
              </div>
              <button 
                onClick={() => setShowIosInstructions(false)}
                className="w-full bg-slate-800 hover:bg-slate-700 text-white font-black py-3 rounded-xl transition-colors"
              >
                فهمت ذلك
              </button>
            </div>
            {/* Pointer arrow for mobile Safari */}
            <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 translate-y-full text-white animate-bounce md:hidden">
              <div className="flex flex-col items-center gap-2 mt-4">
                 <span className="text-[10px] font-black">اضغط هنا</span>
                 {/* viewBox كانت "0 24 24" — ثلاث قيم بدل أربع، فلا يُرسم السهم */}
                 <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M19 12l-7 7-7-7"/></svg>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Developer Options Security Lock Screen Overlay */}
      {developerModeStatus.enabled && currentUser?.role !== 'admin' && (
        <div className="fixed inset-0 z-[999] bg-slate-950 text-white flex flex-col items-center justify-center p-4 md:p-6 text-center animate-in fade-in duration-300">
          <div className="bg-red-500/10 p-4 md:p-6 rounded-full border border-red-500/30 mb-6 animate-pulse">
            <ShieldAlert size={64} className="text-red-500" />
          </div>
          <h2 className="text-2xl font-black text-red-500 mb-2">تم حظر فتح التطبيق</h2>
          <div className="bg-red-950/50 border border-red-800/60 p-4 rounded-2xl max-w-md text-xs font-bold leading-relaxed text-red-200 mb-6">
            <p className="mb-2">⚠️ تم اكتشاف تفعيل "وضع المطور" (Developer Options) أو "تصحيح USB" على هاتف الأندرويد.</p>
            <p>لدواعي أمان النظام ومنع التلاعب بمواقع الزيارات، يتوجب عليك إيقاف وضع المطور أولاً لتتمكن من استخدام التطبيق.</p>
          </div>
          <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl max-w-md text-right text-xs space-y-2 text-slate-300 mb-6">
            <div className="font-black text-white border-b border-slate-800 pb-2 flex items-center gap-2">
              <Smartphone size={16} className="text-blue-400" /> خطوات فتح التطبيق:
            </div>
            <p>1. افتح "إعدادات الهاتف" (Settings).</p>
            <p>2. اذهب إلى "خيارات المطور" (Developer Options) أو "النظام".</p>
            <p>3. قم بـ **إيقاف/تعطيل** خيارات المطور (Developer Options Off).</p>
            <p>4. عد لتطبيق Cust Follow واضغط إعادة الفحص بالأسفل.</p>
          </div>
          {/* التدرّج مكتوب هنا لا عبر bg-red-600: skin.css يفرض على
              button.bg-red-600 تدرّجاً يبدأ بـ #EF4444 بـ !important، والأبيض
              عليه 3.50:1 — دون الحدّ. هذا التدرّج أدكن: 4.83:1 إلى 6.42:1. */}
          <button
            onClick={() => setDeveloperModeStatus(checkDeveloperOptionsStatus())}
            className="text-white font-black px-5 md:px-8 py-3.5 rounded-2xl text-sm shadow-xl transition-all cursor-pointer flex items-center gap-2"
            style={{ backgroundImage: 'linear-gradient(135deg, #DC2626 0%, #B91C1C 100%)' }}
          >
            <RefreshCw size={18} />
            إعادة الفحص الآن
          </button>
        </div>
      )}
    </div>
  );
};

export default App;

