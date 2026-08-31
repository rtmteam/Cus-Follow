
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { AppConfig, Customer } from '../types';
import {
  Table, Download, LogIn, Loader2, AlertCircle, Filter, RefreshCw, ShieldCheck,
  FileSpreadsheet, Eye, EyeOff, Store, DoorOpen, DoorClosed, Ban, Clock,
  Wallet, AlertTriangle, ChevronDown, Search, X, Users
} from 'lucide-react';
import * as XLSX from 'xlsx';

/** صفّ زيارة كما يصل من الخادم */
interface VisitRow {
  logDate: string;
  id: string;
  employeeName: string;
  serialNumber: string;
  job: string;
  agencyCode: string;
  agencyName: string;
  customerCode: string;
  customerName: string;
  repCode: string;
  repName: string;
  startTime: string;
  startGps: string;
  endTime: string;
  endGps: string;
  durationMin: number | null;
  overdueReason: string;
  actualDebt: number | null;
  overdueDays: number | null;
  paymentDate: string;
  comment: string;
  totalDebt: number;
  overdueDebt: number;
  status: 'open' | 'closed' | 'cancelled' | string;
}

interface ReportsViewProps {
  syncUrl?: string;
  adminConfig?: AppConfig;
  onUpdateConfig?: (cfg: Partial<AppConfig>) => void;
  logAction?: (action: string, details?: string) => void;
  onLoginStateChange?: (v: boolean) => void;
  onLogoutRef?: React.MutableRefObject<(() => void) | null>;
  /** يدخل بصلاحية المسؤول تلقائياً — تستعمله لوحة الإدارة */
  autoLoginAdmin?: boolean;
}

const STATUS_LABEL: Record<string, string> = {
  closed: 'مكتملة',
  cancelled: 'ملغاة',
  open: 'مفتوحة'
};

const STATUS_TONE: Record<string, string> = {
  closed: 'text-green-400 bg-green-900/20 border-green-800/50',
  cancelled: 'text-red-400 bg-red-900/20 border-red-800/50',
  open: 'text-amber-300 bg-amber-950/40 border-amber-800/60'
};

const money = (v: number | null | undefined) =>
  (typeof v === 'number' && !isNaN(v) ? v : 0).toLocaleString('en-US', { maximumFractionDigits: 2 });

/** YYYY-MM-DD من أي صيغة تاريخ، أو "" إن تعذّر */
const dayOf = (value: any): string => {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const timeOf = (value: any): string => {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
};

/** قائمة اختيار متعدّد مضغوطة — تُغلق عند الضغط خارجها */
const MultiSelect: React.FC<{
  label: string;
  options: string[];
  selected: string[];
  onChange: (v: string[]) => void;
  icon?: any;
}> = ({ label, options, selected, onChange, icon: Icon }) => {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const shown = q.trim()
    ? options.filter(o => o.toLowerCase().includes(q.trim().toLowerCase()))
    : options;

  const toggle = (v: string) =>
    onChange(selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v]);

  return (
    <div className="space-y-1.5" ref={boxRef}>
      <label className="text-xs font-bold text-slate-400 flex items-center gap-1.5">
        {Icon && <Icon size={13} />} {label}
      </label>
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className={`w-full flex items-center justify-between gap-2 bg-slate-900 border rounded-xl px-3.5 py-3 text-right transition-all min-h-[44px] ${
            open ? 'border-blue-500' : 'border-slate-700'
          }`}
        >
          <span className={`text-xs font-bold truncate ${selected.length ? 'text-white' : 'text-slate-500'}`}>
            {selected.length === 0 ? 'الكل' : selected.length === 1 ? selected[0] : `${selected.length} محدّد`}
          </span>
          <ChevronDown size={16} className={`text-slate-500 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>

        {open && (
          <div className="absolute z-40 mt-1.5 w-full bg-slate-900 border border-slate-600 rounded-xl shadow-2xl overflow-hidden">
            <div className="p-2 border-b border-slate-700">
              <input
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="بحث…"
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-blue-500 text-right"
              />
            </div>
            <div className="max-h-52 overflow-y-auto p-1.5 space-y-1">
              {shown.length === 0 ? (
                <div className="text-center text-xs text-slate-500 font-bold py-4">لا نتائج</div>
              ) : (
                shown.map(o => (
                  <button
                    key={o}
                    type="button"
                    onClick={() => toggle(o)}
                    className={`w-full text-right px-3 py-2.5 rounded-lg text-xs font-bold transition-all min-h-[40px] ${
                      selected.includes(o) ? 'bg-blue-600/20 text-blue-300 border border-blue-600/40' : 'text-slate-300 border border-transparent'
                    }`}
                  >
                    {o}
                  </button>
                ))
              )}
            </div>
            {selected.length > 0 && (
              <button
                type="button"
                onClick={() => onChange([])}
                className="w-full py-2.5 text-xs font-black text-slate-400 border-t border-slate-700 min-h-[40px]"
              >
                مسح التحديد
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const ReportsView: React.FC<ReportsViewProps> = ({
  syncUrl, adminConfig, onUpdateConfig, logAction, onLoginStateChange, onLogoutRef, autoLoginAdmin
}) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isAdminLogin, setIsAdminLogin] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState('');

  const [visits, setVisits] = useState<VisitRow[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);

  // ---------- المرشّحات ----------
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [selEmployees, setSelEmployees] = useState<string[]>([]);
  const [selAgencies, setSelAgencies] = useState<string[]>([]);
  const [selReps, setSelReps] = useState<string[]>([]);
  const [selStatus, setSelStatus] = useState<string[]>([]);
  const [search, setSearch] = useState('');

  useEffect(() => { onLoginStateChange?.(isLoggedIn); }, [isLoggedIn]);

  const activeUrl = syncUrl || adminConfig?.syncUrl || '';

  const fetchData = async (silent = false, u?: string, p?: string) => {
    const user = u !== undefined ? u : username;
    const pass = p !== undefined ? p : password;

    if (!activeUrl) { setError('التطبيق غير مربوط بالسحابة. راجع المسؤول.'); return; }
    if (!user || !pass) { setError('أدخل اسم المستخدم وكلمة المرور.'); return; }

    silent ? setIsRefreshing(true) : setIsLoading(true);
    setError('');

    try {
      const res = await fetch(
        `${activeUrl}?action=getReportData&user=${encodeURIComponent(user)}&pass=${encodeURIComponent(pass)}&t=${Date.now()}`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      if (data.error) {
        setError('بيانات الدخول غير صحيحة.');
        if (!silent) setIsLoggedIn(false);
        return;
      }

      setVisits(Array.isArray(data.visits) ? data.visits : []);
      setCustomers(Array.isArray(data.customers) ? data.customers : []);
      setIsAdminLogin(!!(adminConfig && user === adminConfig.adminUsername && pass === adminConfig.adminPassword));
      setIsLoggedIn(true);
      logAction?.('دخول شاشة التقارير', `المستخدم: ${user}`);
    } catch (err: any) {
      setError(
        err?.message === 'Failed to fetch'
          ? 'تعذّر الوصول للخادم. تأكد من الإنترنت.'
          : 'تعذّر جلب البيانات. حاول مجدداً.'
      );
      logAction?.('فشل جلب تقارير الزيارات', `المستخدم: ${user} | ${err?.message || ''}`);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  // دخول تلقائي بصلاحية المسؤول من داخل لوحة الإدارة
  useEffect(() => {
    if (!autoLoginAdmin) return;
    const u = adminConfig?.adminUsername || 'admin';
    const p = adminConfig?.adminPassword || '';
    setUsername(u);
    setPassword(p);
    fetchData(false, u, p);
  }, [autoLoginAdmin, activeUrl]);

  useEffect(() => {
    if (!onLogoutRef) return;
    onLogoutRef.current = () => {
      setIsLoggedIn(false);
      setVisits([]);
      setUsername('');
      setPassword('');
      setError('');
    };
  }, [onLogoutRef]);

  // ---------- خيارات المرشّحات ----------
  const uniq = (arr: string[]) => Array.from(new Set(arr.filter(Boolean))).sort();
  const employeeOptions = useMemo(() => uniq(visits.map(v => v.employeeName)), [visits]);
  const agencyOptions   = useMemo(() => uniq(visits.map(v => v.agencyName || v.agencyCode)), [visits]);
  const repOptions      = useMemo(() => uniq(visits.map(v => v.repName || v.repCode)), [visits]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return visits.filter(v => {
      const day = dayOf(v.startTime || v.logDate);
      if (fromDate && day && day < fromDate) return false;
      if (toDate && day && day > toDate) return false;
      if (selEmployees.length && !selEmployees.includes(v.employeeName)) return false;
      if (selAgencies.length && !selAgencies.includes(v.agencyName || v.agencyCode)) return false;
      if (selReps.length && !selReps.includes(v.repName || v.repCode)) return false;
      if (selStatus.length && !selStatus.includes(v.status)) return false;
      if (q) {
        const hay = [
          v.customerCode, v.customerName, v.repCode, v.repName,
          v.employeeName, v.serialNumber, v.agencyCode, v.agencyName, v.overdueReason, v.comment
        ].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [visits, fromDate, toDate, selEmployees, selAgencies, selReps, selStatus, search]);

  const stats = useMemo(() => {
    const closed    = filtered.filter(v => v.status === 'closed');
    const cancelled = filtered.filter(v => v.status === 'cancelled');
    const open      = filtered.filter(v => v.status === 'open');
    const durations = closed.map(v => v.durationMin).filter((d): d is number => typeof d === 'number' && d >= 0);
    const avg = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;
    return {
      total: filtered.length,
      closed: closed.length,
      cancelled: cancelled.length,
      open: open.length,
      avgDuration: avg,
      customersVisited: new Set(filtered.map(v => v.customerCode).filter(Boolean)).size,
      collectedPromise: closed.reduce((sum, v) => sum + (v.actualDebt || 0), 0)
    };
  }, [filtered]);

  const clearFilters = () => {
    setFromDate(''); setToDate('');
    setSelEmployees([]); setSelAgencies([]); setSelReps([]); setSelStatus([]);
    setSearch('');
  };

  const hasFilters =
    !!fromDate || !!toDate || !!search ||
    selEmployees.length > 0 || selAgencies.length > 0 || selReps.length > 0 || selStatus.length > 0;

  // ---------- التصدير ----------
  const exportDetailed = () => {
    if (filtered.length === 0) { alert('لا توجد زيارات مطابقة للتصدير.'); return; }
    const rows = filtered.map(v => ({
      'التاريخ': dayOf(v.startTime || v.logDate),
      'الموظف': v.employeeName,
      'الرقم التسلسلي': v.serialNumber,
      'الوظيفة': v.job,
      'كود التوكيل': v.agencyCode,
      'اسم التوكيل': v.agencyName,
      'كود العميل': v.customerCode,
      'اسم العميل': v.customerName,
      'كود المندوب': v.repCode,
      'اسم المندوب': v.repName,
      'وقت الفتح': timeOf(v.startTime),
      'وقت الإغلاق': timeOf(v.endTime),
      'المدة (دقيقة)': v.durationMin ?? '',
      'الحالة': STATUS_LABEL[v.status] || v.status,
      'سبب تجاوز الائتمان': v.overdueReason,
      'المديونية الفعلية': v.actualDebt ?? '',
      'أيام التجاوز': v.overdueDays ?? '',
      'موعد السداد': v.paymentDate,
      'ملاحظات الموظف': v.comment,
      'إجمالي المديونية وقت الزيارة': v.totalDebt,
      'الأوفر ديو وقت الزيارة': v.overdueDebt,
      'إحداثيات الفتح': v.startGps,
      'إحداثيات الإغلاق': v.endGps
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Visits');
    logAction?.('تصدير تقرير زيارات تفصيلي', `عدد الصفوف: ${rows.length}`);
    XLSX.writeFile(wb, `Visits_Detailed_${dayOf(new Date())}.xlsx`);
  };

  const exportSummary = () => {
    if (filtered.length === 0) { alert('لا توجد زيارات مطابقة للتصدير.'); return; }
    const byEmp: Record<string, any> = {};
    filtered.forEach(v => {
      const key = v.employeeName || 'غير معروف';
      if (!byEmp[key]) {
        byEmp[key] = {
          'الموظف': key,
          'الرقم التسلسلي': v.serialNumber,
          'التوكيل': v.agencyName || v.agencyCode,
          'إجمالي الزيارات': 0,
          'مكتملة': 0,
          'ملغاة': 0,
          'مفتوحة': 0,
          'عملاء مختلفون': new Set<string>(),
          '_durations': [] as number[],
          'إجمالي المديونية الفعلية المسجّلة': 0
        };
      }
      const r = byEmp[key];
      r['إجمالي الزيارات']++;
      if (v.status === 'closed') r['مكتملة']++;
      else if (v.status === 'cancelled') r['ملغاة']++;
      else r['مفتوحة']++;
      if (v.customerCode) r['عملاء مختلفون'].add(v.customerCode);
      if (typeof v.durationMin === 'number' && v.durationMin >= 0) r['_durations'].push(v.durationMin);
      r['إجمالي المديونية الفعلية المسجّلة'] += v.actualDebt || 0;
    });

    const rows = Object.values(byEmp).map((r: any) => {
      const d = r['_durations'];
      return {
        'الموظف': r['الموظف'],
        'الرقم التسلسلي': r['الرقم التسلسلي'],
        'التوكيل': r['التوكيل'],
        'إجمالي الزيارات': r['إجمالي الزيارات'],
        'مكتملة': r['مكتملة'],
        'ملغاة': r['ملغاة'],
        'مفتوحة': r['مفتوحة'],
        'عملاء مختلفون': r['عملاء مختلفون'].size,
        'متوسط المدة (دقيقة)': d.length ? Math.round(d.reduce((a: number, b: number) => a + b, 0) / d.length) : 0,
        'إجمالي المديونية الفعلية المسجّلة': Math.round(r['إجمالي المديونية الفعلية المسجّلة'])
      };
    });

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Summary');
    logAction?.('تصدير ملخّص زيارات', `عدد الموظفين: ${rows.length}`);
    XLSX.writeFile(wb, `Visits_Summary_${dayOf(new Date())}.xlsx`);
  };

  // ======================================================
  //  شاشة الدخول
  // ======================================================
  if (!isLoggedIn) {
    if (autoLoginAdmin) {
      return (
        <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
          <div className="w-16 h-16 rounded-2xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400 mb-4">
            <Loader2 className="animate-spin" size={32} />
          </div>
          <h3 className="text-white font-black text-base">جارٍ تحميل تقارير الزيارات…</h3>
          <p className="text-slate-400 text-xs mt-1">بصلاحية المسؤول</p>
          {error && (
            <div className="mt-4 p-4 bg-red-900/30 border border-red-500/50 rounded-2xl text-red-300 text-xs font-bold max-w-md flex flex-col items-center gap-3">
              <div className="flex items-center gap-2">
                <AlertCircle size={18} className="shrink-0" /><span>{error}</span>
              </div>
              <button
                type="button"
                onClick={() => fetchData(false, adminConfig?.adminUsername || 'admin', adminConfig?.adminPassword || '')}
                className="bg-blue-600 text-white px-4 py-2.5 rounded-xl text-xs font-black flex items-center gap-2 min-h-[40px]"
              >
                <RefreshCw size={14} /> إعادة المحاولة
              </button>
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="flex items-center justify-center py-12 px-4">
        <div className="bg-slate-800 rounded-3xl p-5 md:p-8 w-full max-w-md border border-slate-700 shadow-2xl">
          <div className="text-center mb-8">
            <div className="bg-blue-600 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-blue-900/20">
              <FileSpreadsheet size={32} className="text-white" />
            </div>
            <h2 className="text-xl font-black text-white">تقارير الزيارات</h2>
            <p className="text-slate-400 text-xs font-bold mt-1">عرض وتصفية وتصدير زيارات العملاء</p>
          </div>
          <form onSubmit={e => { e.preventDefault(); fetchData(); }} className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-400">اسم المستخدم</label>
              <input
                type="text" value={username} onChange={e => setUsername(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 text-white px-5 py-3.5 rounded-2xl font-bold outline-none focus:border-blue-500 transition-all"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-400">كلمة المرور</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 text-white pl-12 pr-5 py-3.5 rounded-2xl font-bold outline-none focus:border-blue-500 transition-all"
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>
            {error && (
              <div className="p-3 bg-red-900/20 border border-red-500/50 rounded-xl text-red-400 text-xs font-bold flex gap-2 items-center">
                <AlertCircle size={16} className="shrink-0" /><span>{error}</span>
              </div>
            )}
            <button
              disabled={isLoading} type="submit"
              className="w-full bg-blue-600 text-white py-4 rounded-2xl font-black shadow-xl flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-50"
            >
              {isLoading ? <Loader2 className="animate-spin" size={20} /> : <LogIn size={20} />}
              دخول واستعراض التقارير
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ======================================================
  //  التقارير
  // ======================================================
  const kpi = (label: string, value: string | number, Icon: any, tone: string) => (
    <div className="bg-slate-900 rounded-2xl p-3.5 border border-slate-700">
      <div className={`flex items-center gap-1.5 text-[11px] font-bold mb-1.5 ${tone}`}>
        <Icon size={13} /> {label}
      </div>
      <div className="text-xl font-black text-white" style={{ direction: 'ltr', textAlign: 'right' }}>{value}</div>
    </div>
  );

  return (
    <div className="space-y-5">
      {/* الترويسة */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 bg-slate-800 p-4 md:p-5 rounded-3xl border border-slate-700 shadow-xl">
        <div>
          <h2 className="text-lg font-black text-blue-400 flex items-center gap-2">
            {isAdminLogin ? <ShieldCheck size={22} className="text-orange-400" /> : <Table size={22} />}
            تقارير الزيارات
            {isAdminLogin && (
              <span className="text-[11px] text-orange-400 bg-orange-400/10 px-2 py-0.5 rounded-lg border border-orange-400/20 font-bold">
                صلاحية المسؤول
              </span>
            )}
          </h2>
          <p className="text-slate-400 text-xs font-bold mt-1">
            المستخدم: {username} · {visits.length} زيارة محمّلة
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button" onClick={() => fetchData(true)} disabled={isRefreshing}
            className="flex items-center gap-2 px-4 py-3 bg-slate-700 text-white rounded-xl font-black text-xs transition-all min-h-[44px] disabled:opacity-50"
          >
            <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} /> تحديث
          </button>
          <button
            type="button" onClick={exportSummary}
            className="flex items-center gap-2 px-4 py-3 bg-emerald-700 hover:bg-emerald-600 text-white rounded-xl font-black text-xs transition-all min-h-[44px]"
          >
            <FileSpreadsheet size={14} /> ملخّص الموظفين
          </button>
          <button
            type="button" onClick={exportDetailed}
            className="flex items-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-xl font-black text-xs transition-all min-h-[44px]"
          >
            <Download size={14} /> تصدير تفصيلي
          </button>
        </div>
      </div>

      {/* المؤشّرات */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2.5">
        {kpi('إجمالي الزيارات', stats.total, Table, 'text-blue-400')}
        {kpi('مكتملة', stats.closed, DoorClosed, 'text-green-400')}
        {kpi('ملغاة', stats.cancelled, Ban, 'text-red-400')}
        {kpi('مفتوحة الآن', stats.open, DoorOpen, 'text-amber-300')}
        {kpi('متوسط المدة (د)', stats.avgDuration, Clock, 'text-cyan-400')}
        {kpi('عملاء مختلفون', stats.customersVisited, Store, 'text-slate-300')}
      </div>

      {/* المرشّحات */}
      <div className="bg-slate-800 p-4 md:p-5 rounded-3xl border border-slate-700 shadow-lg space-y-4">
        <div className="flex justify-between items-center border-b border-slate-700 pb-3 flex-wrap gap-2">
          <h3 className="text-sm font-black text-white flex items-center gap-2">
            <Filter size={15} className="text-blue-400" /> تصفية الزيارات
          </h3>
          <div className="flex items-center gap-3">
            <span className="text-xs font-bold text-slate-400">
              المعروض: <span className="text-white">{filtered.length}</span> من {visits.length}
            </span>
            {hasFilters && (
              <button
                type="button" onClick={clearFilters}
                className="flex items-center gap-1.5 text-xs font-black text-red-300 bg-red-950/40 border border-red-800/60 px-3 py-2 rounded-lg min-h-[36px]"
              >
                <X size={13} /> مسح المرشّحات
              </button>
            )}
          </div>
        </div>

        <div className="relative">
          <input
            type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="بحث في العميل أو المندوب أو الموظف أو السبب أو الملاحظات…"
            className="w-full bg-slate-900 border border-slate-700 text-white pr-10 pl-4 py-3 rounded-xl font-bold outline-none focus:border-blue-500 transition-all text-right text-sm placeholder:text-slate-500"
          />
          <Search size={16} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-400">من تاريخ</label>
            <input
              type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 text-white px-3.5 py-3 rounded-xl font-bold outline-none focus:border-blue-500 min-h-[44px]"
              style={{ direction: 'ltr' }}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-400">إلى تاريخ</label>
            <input
              type="date" value={toDate} onChange={e => setToDate(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 text-white px-3.5 py-3 rounded-xl font-bold outline-none focus:border-blue-500 min-h-[44px]"
              style={{ direction: 'ltr' }}
            />
          </div>
          <MultiSelect label="الحالة" icon={Filter} options={['closed', 'cancelled', 'open']} selected={selStatus} onChange={setSelStatus} />
          <MultiSelect label="الموظف" icon={Users} options={employeeOptions} selected={selEmployees} onChange={setSelEmployees} />
          <MultiSelect label="التوكيل" icon={Store} options={agencyOptions} selected={selAgencies} onChange={setSelAgencies} />
          <MultiSelect label="المندوب" icon={Users} options={repOptions} selected={selReps} onChange={setSelReps} />
        </div>
      </div>

      {/* الجدول */}
      <div className="bg-slate-800 rounded-3xl border border-slate-700 shadow-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right md:min-w-[1200px]">
            <thead>
              <tr className="border-b border-slate-700 text-[11px] font-black text-slate-500 text-center">
                <th className="py-4 px-2 text-right">العميل</th>
                <th className="py-4 px-2">المندوب</th>
                <th className="py-4 px-2">الموظف</th>
                <th className="py-4 px-2">التاريخ</th>
                <th className="py-4 px-2">الفتح ← الإغلاق</th>
                <th className="py-4 px-2">المدة</th>
                <th className="py-4 px-2">الحالة</th>
                <th className="py-4 px-2">سبب التجاوز</th>
                <th className="py-4 px-2">المديونية الفعلية</th>
                <th className="py-4 px-2">أيام التجاوز</th>
                <th className="py-4 px-2">موعد السداد</th>
                <th className="py-4 px-2 text-right">ملاحظات</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={12} className="py-14 text-center">
                    <Store size={38} className="mx-auto opacity-20 mb-3" />
                    <div className="text-sm font-bold text-slate-300">
                      {visits.length === 0 ? 'لا توجد زيارات مسجّلة بعد' : 'لا زيارات مطابقة للمرشّحات'}
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                      {visits.length === 0
                        ? 'ستظهر هنا الزيارات فور أن يفتحها الموظفون من هواتفهم.'
                        : 'وسّع الفترة الزمنية أو امسح المرشّحات.'}
                    </div>
                  </td>
                </tr>
              ) : (
                filtered.map(v => (
                  <tr key={v.id || `${v.customerCode}-${v.startTime}`} className="border-b border-slate-700/50 text-center">
                    <td data-label="العميل" className="py-3.5 px-2 text-right">
                      <div className="flex flex-col">
                        <span className="font-bold text-sm text-white">{v.customerName}</span>
                        <span className="text-amber-400 text-xs font-black font-mono">{v.customerCode}</span>
                      </div>
                    </td>
                    <td data-label="المندوب" className="py-3.5 px-2">
                      <div className="flex flex-col">
                        <span className="text-xs text-slate-300 font-bold">{v.repName || '—'}</span>
                        <span className="text-[11px] text-slate-500 font-mono">{v.repCode}</span>
                      </div>
                    </td>
                    <td data-label="الموظف" className="py-3.5 px-2">
                      <div className="flex flex-col">
                        <span className="text-xs text-slate-300 font-bold">{v.employeeName}</span>
                        <span className="text-[11px] text-slate-500 font-mono">{v.agencyName || v.agencyCode}</span>
                      </div>
                    </td>
                    <td data-label="التاريخ" className="py-3.5 px-2 text-xs text-slate-400 font-mono">
                      {dayOf(v.startTime || v.logDate)}
                    </td>
                    <td data-label="الفتح ← الإغلاق" className="py-3.5 px-2 text-xs text-slate-400 font-mono" style={{ direction: 'ltr' }}>
                      {timeOf(v.startTime) || '—'}{v.endTime ? ` → ${timeOf(v.endTime)}` : ''}
                    </td>
                    <td data-label="المدة" className="py-3.5 px-2 text-xs font-black text-cyan-400 font-mono">
                      {typeof v.durationMin === 'number' ? `${v.durationMin}د` : '—'}
                    </td>
                    <td data-label="الحالة" className="py-3.5 px-2">
                      <span className={`inline-block text-[11px] font-black px-2.5 py-1 rounded-lg border ${STATUS_TONE[v.status] || 'text-slate-400 bg-slate-900 border-slate-700'}`}>
                        {STATUS_LABEL[v.status] || v.status}
                      </span>
                    </td>
                    <td data-label="سبب التجاوز" className="py-3.5 px-2 text-xs text-slate-300 font-bold max-w-[180px]">
                      {v.overdueReason || '—'}
                    </td>
                    <td data-label="المديونية الفعلية" className="py-3.5 px-2 text-xs font-black text-white font-mono">
                      {v.actualDebt !== null ? money(v.actualDebt) : '—'}
                    </td>
                    <td data-label="أيام التجاوز" className="py-3.5 px-2 text-xs font-black text-red-400 font-mono">
                      {v.overdueDays !== null ? v.overdueDays : '—'}
                    </td>
                    <td data-label="موعد السداد" className="py-3.5 px-2 text-xs text-slate-400 font-mono">
                      {v.paymentDate || '—'}
                    </td>
                    <td data-label="ملاحظات" className="py-3.5 px-2 text-xs text-slate-400 font-bold text-right max-w-[200px]">
                      {v.comment || '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {stats.open > 0 && (
        <div className="bg-amber-950/25 border border-amber-800/50 rounded-2xl p-4 text-xs font-bold text-amber-200/90 leading-relaxed flex items-start gap-2.5">
          <AlertTriangle size={15} className="shrink-0 mt-0.5" />
          <span>
            توجد {stats.open} زيارة مفتوحة لم تُغلق بعد. الزيارة المفتوحة تعني أن الموظف بدأها ولم يُنهها —
            إمّا أنه ما زال عند العميل، وإمّا أنه نسي إغلاقها.
          </span>
        </div>
      )}
    </div>
  );
};

export default ReportsView;
