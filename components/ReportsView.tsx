
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { FileSpreadsheet, Download, LogIn, LogOut, Loader2, Table, Calendar as CalendarIcon, MapPin, User as UserIcon, Briefcase, Filter, RefreshCw, ChevronRight, ChevronLeft, X, Link as LinkIcon, AlertCircle, Check, ShieldCheck, ChevronDown, Search, Eye, EyeOff, BarChart3, TrendingUp, CheckCircle, Clock } from 'lucide-react';
import * as XLSX from 'xlsx';
import { AppConfig } from '../types';

interface ReportsViewProps {
  syncUrl: string;
  adminConfig: AppConfig;
  onUpdateConfig?: (cfg: Partial<AppConfig>) => void;
  logAction?: (action: string, details?: string) => void;
  onLoginStateChange?: (loggedIn: boolean) => void;
  onLogoutRef?: React.MutableRefObject<(() => void) | null>;
  autoLoginAdmin?: boolean;
}

/**
 * @param aliases نصّ بحث إضافي لكل خيار (كود الفرع مثلاً).
 *   البحث يطابق الخيار **أو** رديفه، لكن القيمة المختارة تبقى الخيار نفسه —
 *   فلا يتغيّر شيء في منطق التصفية ولا في التقارير المُصدَّرة.
 *   اختيارية، فبقية استعمالات المكوّن لا تتأثر.
 */
const MultiSelect = ({ label, options, selected, onToggle, placeholder, icon: Icon, aliases }: { label: string, options: string[], selected: string[], onToggle: (val: string) => void, placeholder: string, icon: any, aliases?: Record<string, string> }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const q = search.trim().toLowerCase();
  const filtered = options.filter(o => {
    if (q === '') return true;
    if (o.toLowerCase().includes(q)) return true;
    const alias = aliases?.[o];
    return !!alias && alias.toLowerCase().includes(q);
  });

  return (
    <div className="relative space-y-1 w-full text-right" ref={wrapperRef}>
      <label className="text-[9px] font-black text-white mr-2 uppercase flex items-center gap-1"><Icon size={10} /> {label}</label>
      <button 
        type="button"
        onClick={() => setIsOpen(!isOpen)} 
        className="w-full bg-slate-900 border border-slate-700 text-white px-4 py-2.5 rounded-xl text-xs font-bold text-right flex justify-between items-center hover:border-blue-500 transition-all shadow-inner"
      >
        <span className="truncate max-w-[150px]">
          {selected.length === 0 ? placeholder : 
           selected.length === 1 ? selected[0] : 
           `${selected.length} مختار`}
        </span>
        <ChevronDown size={14} className={`text-slate-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      
      {isOpen && (
        <div className="absolute z-50 mt-2 p-2 bg-slate-800 border border-slate-600 rounded-2xl shadow-2xl w-full left-0 animate-in fade-in zoom-in-95 duration-200">
          <div className="relative mb-2">
            <input 
              type="text" 
              placeholder={aliases ? "بحث بالاسم أو الكود..." : "بحث..."}
              className="w-full bg-slate-900 border border-slate-700 text-white px-5 md:px-8 py-2 rounded-lg text-[10px] outline-none focus:border-blue-500"
              value={search}
              onChange={e => setSearch(e.target.value)}
              autoFocus
            />
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
          </div>
          <div className="max-h-48 overflow-y-auto scrollbar-hide space-y-1">
            {filtered.length === 0 ? (
              <div className="text-[10px] text-slate-500 text-center py-2 italic">لا توجد نتائج</div>
            ) : (
              filtered.map(opt => (
                <button 
                  key={opt}
                  type="button"
                  onClick={() => onToggle(opt)}
                  className={`w-full text-right px-3 py-2 rounded-lg text-[10px] font-bold transition-all flex items-center justify-between gap-2 ${selected.includes(opt) ? 'bg-blue-600 text-white' : 'hover:bg-slate-700 text-slate-300'}`}
                >
                  <span className="flex items-center gap-1.5 min-w-0">
                    <span className="truncate">{opt}</span>
                    {aliases?.[opt] && (
                      <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded shrink-0 ${selected.includes(opt) ? 'bg-white/20 text-white' : 'bg-slate-900 text-amber-400'}`}>
                        {aliases[opt]}
                      </span>
                    )}
                  </span>
                  {selected.includes(opt) && <Check size={12} className="shrink-0" />}
                </button>
              ))
            )}
          </div>
          {selected.length > 0 && (
            <button 
              type="button"
              onClick={() => { selected.slice().forEach(s => onToggle(s)); setIsOpen(false); }} 
              className="w-full mt-2 py-1.5 text-[8px] text-red-400 hover:bg-red-900/20 font-black uppercase rounded-lg border border-red-900/30"
            >
              مسح المختار
            </button>
          )}
        </div>
      )}
    </div>
  );
};

const CustomDatePicker = ({ label, value, onChange, placeholder }: { label: string, value: string, onChange: (val: string) => void, placeholder: string }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [viewDate, setViewDate] = useState(new Date());
  const daysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
  const firstDayOfMonth = (year: number, month: number) => new Date(year, month, 1).getDay();
  const handleDateClick = (day: number) => {
    const selected = new Date(viewDate.getFullYear(), viewDate.getMonth(), day);
    const offset = selected.getTimezoneOffset();
    const adjustedDate = new Date(selected.getTime() - (offset * 60 * 1000));
    onChange(adjustedDate.toISOString().split('T')[0]);
    setIsOpen(false);
  };
  const changeMonth = (offset: number) => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + offset, 1));
  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return (
    <div className="relative space-y-1 w-full text-right">
      <label className="text-[9px] font-black text-white mr-2 uppercase">{label}</label>
      <button type="button" onClick={() => setIsOpen(!isOpen)} className="w-full bg-slate-900 border border-slate-700 text-white px-4 py-2.5 rounded-xl text-xs font-bold text-right flex justify-between items-center hover:border-blue-500 transition-all shadow-inner"><span>{value || placeholder}</span><CalendarIcon size={14} className="text-slate-500" /></button>
      {isOpen && (<div className="absolute z-50 mt-2 p-4 bg-slate-800 border border-slate-600 rounded-2xl shadow-2xl w-64 right-0"><div className="flex justify-between items-center mb-4"><button type="button" onClick={() => changeMonth(-1)} className="p-1 hover:bg-slate-700 rounded-lg text-white"><ChevronRight size={18} /></button><span className="text-xs font-black text-blue-400">{monthNames[viewDate.getMonth()]} {viewDate.getFullYear()}</span><button type="button" onClick={() => changeMonth(1)} className="p-1 hover:bg-slate-700 rounded-lg text-white"><ChevronLeft size={18} /></button></div><div className="grid grid-cols-7 gap-1 text-center mb-2">{["S", "M", "T", "W", "T", "F", "S"].map(d => (<span key={d} className="text-[10px] text-slate-500 font-bold">{d}</span>))}</div><div className="grid grid-cols-7 gap-1 text-center">{Array.from({ length: firstDayOfMonth(viewDate.getFullYear(), viewDate.getMonth()) }).map((_, i) => (<div key={`empty-${i}`} />))}{Array.from({ length: daysInMonth(viewDate.getFullYear(), viewDate.getMonth()) }).map((_, i) => { const day = i + 1; const isSelected = value === new Date(viewDate.getFullYear(), viewDate.getMonth(), day).toISOString().split('T')[0]; return (<button key={day} type="button" onClick={() => handleDateClick(day)} className={`py-1.5 text-[10px] font-bold rounded-lg transition-all ${isSelected ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-300 hover:bg-slate-700'}`}>{day}</button>); })}</div><button type="button" onClick={() => setIsOpen(false)} className="w-full mt-4 py-1 text-[9px] text-slate-500 hover:text-white font-black uppercase tracking-widest border-t border-slate-700 pt-2">إغلاق</button></div>)}
    </div>
  );
};

export default function ReportsView({ syncUrl: initialSyncUrl, adminConfig, onUpdateConfig, logAction, onLoginStateChange, onLogoutRef, autoLoginAdmin }: ReportsViewProps) {
  const [localSyncUrl, setLocalSyncUrl] = useState(initialSyncUrl || localStorage.getItem('attendance_temp_sync_url') || '');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  useEffect(() => {
    onLoginStateChange?.(isLoggedIn);
  }, [isLoggedIn, onLoginStateChange]);

  useEffect(() => {
    if (onLogoutRef) {
      onLogoutRef.current = () => {
        setIsLoggedIn(false);
        logAction?.('تسجيل خروج متابع تقارير', `المستخدم: ${username}`);
      };
    }
  }, [onLogoutRef, username, logAction]);
  const [isAdminLogin, setIsAdminLogin] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [records, setRecords] = useState<any[]>([]);
  const [authorizedUsers, setAuthorizedUsers] = useState<any[]>([]); // New state for users
  const [visitPlans, setVisitPlans] = useState<any[]>([]); // New state for visit plans
  const [fetchedJobs, setFetchedJobs] = useState<any[]>([]);
  const [fetchedBranches, setFetchedBranches] = useState<any[]>([]);
  const [fetchedHolidays, setFetchedHolidays] = useState<string[]>([]);

  /**
   * استخراج كود الفرع.
   *
   * عمود "Default Branch" في شيت الموظفين يخزّن **معرّف** الفرع لا اسمه،
   * فالمطابقة بالاسم وحدها كانت تفشل دائماً في مسار الملخّص.
   * نطابق هنا بالمعرّف والاسم معاً، ونقدّم ما يرسله الخادم جاهزاً إن وُجد.
   */
  const getBranchCode = (branchNameOrId?: string, entity?: any) => {
    if (entity?.branchCode) return entity.branchCode;
    if (entity?.branch_code) return entity.branch_code;
    if (entity?.code) return entity.code;

    const keys = [branchNameOrId, entity?.defaultBranchId, entity?.branchId]
      .filter(Boolean)
      .map(v => v!.toString().trim().toLowerCase());
    if (keys.length === 0) return '';

    const found = fetchedBranches.find(b =>
      keys.indexOf((b.id ?? '').toString().trim().toLowerCase()) !== -1 ||
      keys.indexOf((b.name ?? '').toString().trim().toLowerCase()) !== -1
    );
    return found?.code || '';
  };

  /** اسم الفرع المقروء — يحلّ المعرّف العشوائي إن لم يُحلّه الخادم */
  const getBranchName = (branchNameOrId?: string, entity?: any) => {
    const raw = (branchNameOrId ?? '').toString().trim();
    if (!raw) return '';
    const key = raw.toLowerCase();
    const found = fetchedBranches.find(b => (b.id ?? '').toString().trim().toLowerCase() === key);
    return found?.name || raw;
  };
  const [error, setError] = useState('');
  const [showUrlField, setShowUrlField] = useState(!initialSyncUrl);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [selectedJobs, setSelectedJobs] = useState<string[]>([]);
  const [selectedEmployees, setSelectedEmployees] = useState<string[]>([]);
  const [selectedBranches, setSelectedBranches] = useState<string[]>([]);
  const [dashSearch, setDashSearch] = useState('');
  const [dashFilter, setDashFilter] = useState<'all' | 'high' | 'med' | 'low'>('all');
  const activeSyncUrl = localSyncUrl || initialSyncUrl;

  const fetchData = async (showLoading = true, customUser?: string, customPass?: string) => {
    const u = customUser !== undefined ? customUser : username;
    const p = customPass !== undefined ? customPass : password;
    if (!activeSyncUrl) { setError('يرجى إدخال رابط المزامنة الخاص بالشركة أولاً'); setShowUrlField(true); return; }
    if (!u || !p) { setError('يرجى إدخل اسم المستخدم وكلمة المرور'); return; }
    if (showLoading) setIsLoading(true); else setIsRefreshing(true);
    setError('');
    try {
      const response = await fetch(`${activeSyncUrl}?action=getReportData&user=${encodeURIComponent(u)}&pass=${encodeURIComponent(p)}`);
      const data = await response.json();
      if (data.error) { 
        setError('بيانات الدخول غير صحيحة'); 
        if (showLoading) setIsLoggedIn(false); 
      } else { 
        // Handle new response format { records: [], users: [] }
        if (Array.isArray(data)) {
           // Backward compatibility
           setRecords(data); 
           setAuthorizedUsers([]);
           setVisitPlans([]);
        } else {
           setRecords(data.records || []);
           const users = (data.users && data.users.length > 0) ? data.users : JSON.parse(localStorage.getItem('attendance_users') || '[]');
           setAuthorizedUsers(users);
           const plans = (data.visitPlans && data.visitPlans.length > 0) ? data.visitPlans : JSON.parse(localStorage.getItem('attendance_visit_plans') || '[]');
           setVisitPlans(plans);
           const jobs = (data.jobs && data.jobs.length > 0) ? data.jobs : JSON.parse(localStorage.getItem('attendance_jobs') || '[]');
           setFetchedJobs(jobs);
           const branches = (data.branches && data.branches.length > 0) ? data.branches : JSON.parse(localStorage.getItem('attendance_branches') || '[]');
           setFetchedBranches(branches);
           const config = JSON.parse(localStorage.getItem('attendance_config') || '{}');
           const holidays = (data.holidays && data.holidays.length > 0) ? data.holidays : (config.holidays || []);
           setFetchedHolidays(holidays);
        }
        setIsLoggedIn(true); 
        logAction?.('تسجيل دخول متابع تقارير', `المستخدم: ${u}`);
        if (adminConfig && u === adminConfig.adminUsername && p === adminConfig.adminPassword) setIsAdminLogin(true); 
        else setIsAdminLogin(false); 
        localStorage.setItem('attendance_temp_sync_url', activeSyncUrl); 
        setShowUrlField(false); 
      }
    } catch (err) { 
      setError('خطأ في الاتصال'); 
      setShowUrlField(true);
      logAction?.('فشل جلب بيانات التقارير', `المستخدم: ${u}, الخطأ: ${err instanceof Error ? err.message : String(err)}`);
    } finally { setIsLoading(false); setIsRefreshing(false); }
  };

  useEffect(() => {
    if (autoLoginAdmin) {
      const adminUser = adminConfig?.adminUsername || 'admin';
      const adminPass = adminConfig?.adminPassword || 'Ba522129';
      setUsername(adminUser);
      setPassword(adminPass);
      setIsAdminLogin(true);
      fetchData(true, adminUser, adminPass);
    }
  }, [autoLoginAdmin, adminConfig?.syncUrl]);

  const handleUnlink = () => {
    if (window.confirm('هل أنت متأكد من رغبتك في فك الارتباط بالشركة الحالية؟')) {
      logAction?.('فك الارتباط بالشركة', `المستخدم: ${username}`);
      onUpdateConfig?.({ syncUrl: '', googleSheetLink: '' });
      setIsLoggedIn(false);
      setLocalSyncUrl('');
      setShowUrlField(true);
      setError('');
    }
  };

  const exportToExcel = () => {
    if (!fromDate || !toDate) {
      alert('يرجى تحديد الفترة (من تاريخ / إلى تاريخ) لاستخراج تقرير البيانات الشاملة');
      return;
    }

    // helper to get YYYY-MM-DD from any date input
    const getDateString = (dateInput: any) => {
      if (!dateInput) return '';
      const d = new Date(dateInput);
      if (isNaN(d.getTime())) return '';
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };

    const dataToExport = filteredRecords.map(r => {
      return {
        'Date': getDateString(r.date),
        'Time': new Date(r.time).toLocaleTimeString('en-US'),
        'Employee Name': r.name,
        'Serial Number': r.serialNumber || 'N/A', 
        'Job': r.job,
        'Branch Code': getBranchCode(r.branch, r),
        'Branch': r.branch,
        'Type': r.type === 'check-in' ? 'Check-In' : 'Check-Out',
        'Time Diff': r.timeDiff || '', 
        'Reason/Notes': r.reason || '',
        'GPS Location': r.gps
      };
    });

    const ws = XLSX.utils.json_to_sheet(dataToExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Attendance Report");
    logAction?.('تحميل تقرير (All Data)', `الفترة: ${fromDate} إلى ${toDate}`);
    XLSX.writeFile(wb, `AllData_${username}_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  /**
   * حساب ملخّص الالتزام لكل موظف خلال الفترة المحددة.
   *
   * استُخرجت من exportSummaryExcel دون تغيير أي منطق، ليستفيد منها
   * التصدير إلى Excel ولوحة العرض معاً — فمصدر الأرقام واحد ولا يختلفان.
   *
   * @param silent إن كانت true فلا تُظهر تنبيهاً عند غياب التاريخ (للعرض التلقائي)
   */
  const buildSummary = (silent = false): any[] | null => {
    if (!fromDate || !toDate) { if (!silent) alert('يرجى تحديد الفترة (من تاريخ / إلى تاريخ) لحساب الملخص'); return null; }
    
    // Helper for normalized date strings
    const getDateString = (dateInput: any) => {
      if (!dateInput) return '';
      const d = new Date(dateInput);
      if (isNaN(d.getTime())) return '';
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };

    const todayStr = getDateString(new Date());
    const actualEndStr = toDate > todayStr ? todayStr : toDate;

    // Determine target users to include (All filtered authorized users, even if they have no records)
    const targetUsers = authorizedUsers.length > 0 ? authorizedUsers.filter(u => {
        let match = true;
        if (selectedJobs.length > 0) {
          const selLower = selectedJobs.map(j => j.toLowerCase());
          match = match && selLower.includes(u.jobTitle?.toString().trim().toLowerCase());
        }
        if (selectedEmployees.length > 0) {
          const selLower = selectedEmployees.map(e => e.toLowerCase());
          match = match && selLower.includes(u.fullName?.toString().trim().toLowerCase());
        }
        if (selectedBranches.length > 0) {
          const selLower = selectedBranches.map(b => b.toLowerCase());
          match = match && selLower.includes(u.defaultBranch?.toString().trim().toLowerCase());
        }
        return match;
    }) : [];

    // Use records but filter them for summary to include "Home" even if branch filter is active
    const summaryRecords = records.filter(r => {
      const rdStr = getDateString(r.date);
      let m = true;
      if (fromDate) m = m && rdStr >= fromDate;
      if (toDate) m = m && rdStr <= toDate;
      
      if (selectedJobs.length > 0) {
        const selLower = selectedJobs.map(j => j.toLowerCase());
        m = m && selLower.includes(r.job?.toString().trim().toLowerCase());
      }
      if (selectedEmployees.length > 0) {
        const selLower = selectedEmployees.map(e => e.toLowerCase());
        m = m && selLower.includes(r.name?.toString().trim().toLowerCase());
      }
      
      // Include record if it matches selected branches OR if it is a "Home" or "Out Door" registration
      if (selectedBranches.length > 0) {
        const branchLower = r.branch?.toLowerCase() || '';
        const isHomeOrOut = branchLower.includes('home') || branchLower.includes('out door');
        const selLower = selectedBranches.map(b => b.toLowerCase());
        m = m && (selLower.includes(r.branch?.toString().trim().toLowerCase()) || isHomeOrOut);
      }
      return m;
    });

    // Fallback if authorizedUsers is empty (old backend), use records
    const usersToProcess = targetUsers.length > 0 ? targetUsers : 
      Array.from(new Set(summaryRecords.map(r => r.name))).map(name => {
         const r = summaryRecords.find(x => x.name === name);
         return { fullName: name, jobTitle: r?.job || 'N/A', defaultBranch: r?.branch || 'N/A', serialNumber: r?.serialNumber || 'N/A' };
      });

    const employeeSummary: Record<string, any> = {};
    const parseTimeStr = (str: string) => {
      if (!str) return { h: 0, m: 0 };
      const hoursMatch = str.match(/(\d+)\s*ساعة/);
      const minsMatch = str.match(/(\d+)\s*دقيقة/);
      return {
        h: hoursMatch ? parseInt(hoursMatch[1]) : 0,
        m: minsMatch ? parseInt(minsMatch[1]) : 0
      };
    };

    // Initialize summary for all target users
    usersToProcess.forEach(u => {
      // Use Serial Number as key if available, else Name
      const userId = u.serialNumber && u.serialNumber !== 'undefined' ? u.serialNumber : u.fullName;
      
      const userJob = fetchedJobs.find(j => j.title === u.jobTitle);
      const workingDays = userJob?.workingDays || [0, 1, 2, 3, 4, 6]; // Default all except Friday
      let userWorkingDaysCount = 0;
      const userWorkingDaysSet = new Set<string>();

      const [y, mo, d] = fromDate.split('-');
      const currentDay = new Date(parseInt(y), parseInt(mo)-1, parseInt(d));
      currentDay.setHours(0, 0, 0, 0);

      while (true) {
        const dateStr = getDateString(currentDay);
        if (dateStr > actualEndStr) break;

        const dayOfWeek = currentDay.getDay();
        
        const isWorkingDay = workingDays.includes(dayOfWeek);
        const isHoliday = fetchedHolidays.includes(dateStr);
        
        // Check if there's a "Holiday" visit plan for this user and date
        const userPlan = visitPlans.find(p => {
          if (!p.date) return false;
          
          // 1. Strict Date Matching (Normalize both to YYYY-MM-DD)
          const pDateStr = p.date.toString().trim();
          let normalizedPDate = pDateStr;
          if (pDateStr.includes('T')) {
            normalizedPDate = pDateStr.split('T')[0];
          } else if (pDateStr.includes(' ')) {
            normalizedPDate = pDateStr.split(' ')[0];
          }
          
          // If it's not in YYYY-MM-DD format, try to convert it
          if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedPDate)) {
            const d = new Date(pDateStr);
            if (!isNaN(d.getTime())) {
              normalizedPDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            }
          }

          if (normalizedPDate !== dateStr) return false;

          // 2. User Matching
          const pUser = p.userId?.toString().trim();
          const pName = p.userName?.toString().trim().toLowerCase().replace(/\s+/g, '');
          const pSerial = p.userSerial?.toString().trim();
          const uId = u.id?.toString().trim();
          const uName = u.fullName?.toString().trim().toLowerCase().replace(/\s+/g, '');
          const uSerial = u.serialNumber?.toString().trim();

          const isValid = (val: any) => val && val !== 'N/A' && val !== 'undefined' && val !== '';

          const matchesUser = (isValid(uId) && isValid(pUser) && pUser === uId) || 
                             (isValid(uName) && isValid(pName) && pName === uName) || 
                             (isValid(uSerial) && isValid(pSerial) && pSerial === uSerial) ||
                             (isValid(uSerial) && isValid(pUser) && pUser === uSerial) ||
                             (isValid(uName) && isValid(pUser) && pUser.toLowerCase().replace(/\s+/g, '') === uName) ||
                             (isValid(uSerial) && isValid(pUser) && pUser.includes(uSerial)) ||
                             (isValid(uName) && isValid(pName) && (pName.includes(uName) || uName.includes(pName)));

          return matchesUser && p.branchName === 'Holiday';
        });

        if (isWorkingDay && !isHoliday && !userPlan) {
          userWorkingDaysCount++;
          userWorkingDaysSet.add(dateStr);
        }
        currentDay.setDate(currentDay.getDate() + 1);
      }

      employeeSummary[userId] = {
            name: u.fullName,
            branchCode: getBranchCode(u.defaultBranch, u),
            branchName: getBranchName(u.defaultBranch, u),
            jobTitle: u.jobTitle,
            serialNumber: u.serialNumber || 'N/A',
            workingDaysCount: userWorkingDaysCount,
            workingDaysSet: userWorkingDaysSet,
            attendanceDates: new Set<string>(),
            departureDates: new Set<string>(),
            lateArrivalDays: 0,
            earlyDepartureDays: 0,
            totalLateH: 0, totalLateM: 0,
            totalEarlyH: 0, totalEarlyM: 0,
            totalOvertimeH: 0, totalOvertimeM: 0
      };
    });

    // Populate with attendance records
    const dailyRecords: Record<string, Record<string, { firstIn?: any, lastOut?: any }>> = {};

    summaryRecords.forEach(r => {
      const userId = r.serialNumber && r.serialNumber !== 'undefined' ? r.serialNumber : r.name;
      // Skip if this record doesn't belong to our filtered user list (shouldn't happen if filters match, but safety check)
      if (!employeeSummary[userId]) return;

      const recordDateObj = new Date(r.date);
      const dateKey = `${recordDateObj.getFullYear()}-${String(recordDateObj.getMonth() + 1).padStart(2, '0')}-${String(recordDateObj.getDate()).padStart(2, '0')}`;

      if (!dailyRecords[userId]) dailyRecords[userId] = {};
      if (!dailyRecords[userId][dateKey]) dailyRecords[userId][dateKey] = {};

      const currentDayData = dailyRecords[userId][dateKey];
      const recordTime = new Date(r.time).getTime();

      if (r.type === 'check-in') {
        if (!currentDayData.firstIn || recordTime < new Date(currentDayData.firstIn.time).getTime()) {
          currentDayData.firstIn = r;
        }
      } else if (r.type === 'check-out') {
        if (!currentDayData.lastOut || recordTime > new Date(currentDayData.lastOut.time).getTime()) {
          currentDayData.lastOut = r;
        }
      }
    });

    // Process summarized daily data
    Object.keys(dailyRecords).forEach(userId => {
      const dates = dailyRecords[userId];
      const s = employeeSummary[userId];
      
      Object.keys(dates).forEach(dateKey => {
        const dayData = dates[dateKey];
        
        // Only count if it's a valid working day
        if (s.workingDaysSet.has(dateKey)) {
          // Process First Check-In
          if (dayData.firstIn) {
            s.attendanceDates.add(dateKey); // Count this day for attendance
            
            const branchName = dayData.firstIn.branch?.toLowerCase() || '';
            const isExcludedBranch = branchName.includes('home') || branchName.includes('out door');
            
            if (!isExcludedBranch && dayData.firstIn.timeDiff.includes('متأخر')) {
              s.lateArrivalDays++;
              const t = parseTimeStr(dayData.firstIn.timeDiff);
              s.totalLateH += t.h;
              s.totalLateM += t.m;
            }
          }

          // Process Last Check-Out
          if (dayData.lastOut) {
            s.departureDates.add(dateKey); // Count this day for departure
            
            const branchName = dayData.lastOut.branch?.toLowerCase() || '';
            const isExcludedBranch = branchName.includes('home') || branchName.includes('out door');
            
            if (!isExcludedBranch) {
              const t = parseTimeStr(dayData.lastOut.timeDiff);
              if (dayData.lastOut.timeDiff.includes('مبكر')) {
                s.earlyDepartureDays++;
                s.totalEarlyH += t.h;
                s.totalEarlyM += t.m;
              } else if (dayData.lastOut.timeDiff.includes('متأخر')) {
                s.totalOvertimeH += t.h;
                s.totalOvertimeM += t.m;
              }
            }
          }
        }
      });
    });

    const summaryData = Object.values(employeeSummary).map(s => {
      const lateTotalH = s.totalLateH + Math.floor(s.totalLateM / 60);
      const earlyTotalH = s.totalEarlyH + Math.floor(s.totalEarlyM / 60);
      const overtimeTotalH = s.totalOvertimeH + Math.floor(s.totalOvertimeM / 60);
      const attDaysCount = s.attendanceDates.size;
      const depDaysCount = s.departureDates.size;

      return {
        'اسم الموظف': s.name,
        'الرقم التسلسلي': s.serialNumber || 'N/A',
        'كود الفرع': s.branchCode || '',
        'اسم الفرع': s.branchName,
        'الوظيفة': s.jobTitle,
        'عدد أيام العمل المتاحة': s.workingDaysCount,
        'عدد أيام الحضور': attDaysCount,
        'عدد أيام الانصراف': depDaysCount,
        'عدد أيام الغياب': Math.max(0, s.workingDaysCount - Math.max(attDaysCount, depDaysCount)),
        'عدد أيام الحضور متأخر': s.lateArrivalDays,
        'عدد أيام الانصراف المبكر': s.earlyDepartureDays,
        'ساعات الحضور المتأخر': `${lateTotalH}:${(s.totalLateM % 60).toString().padStart(2, '0')}`,
        'ساعات الانصراف المبكر': `${earlyTotalH}:${(s.totalEarlyM % 60).toString().padStart(2, '0')}`,
        'ساعات الانصراف المتأخر (الإضافي)': `${overtimeTotalH}:${(s.totalOvertimeM % 60).toString().padStart(2, '0')}`
      };
    });

    return summaryData;
  };

  const exportSummaryExcel = () => {
    const summaryData = buildSummary();
    if (!summaryData) return;


    const ws = XLSX.utils.json_to_sheet(summaryData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Summary Report");
    logAction?.('تحميل تقرير (Summary)', `الفترة: ${fromDate} إلى ${toDate}`);
    XLSX.writeFile(wb, `Summary_${username}_${fromDate}_to_${toDate}.xlsx`);
  };

  const exportDetailedExcel = () => {
    if (!fromDate || !toDate) { alert('يرجى تحديد الفترة (من تاريخ / إلى تاريخ) لاستخراج التقرير المفصل'); return; }
    
    // helper to get YYYY-MM-DD from any date input
    const getDateString = (dateInput: any) => {
      if (!dateInput) return '';
      const d = new Date(dateInput);
      if (isNaN(d.getTime())) return '';
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };

    const [fy, fm, fd] = fromDate.split('-');
    const currentDayBase = new Date(parseInt(fy), parseInt(fm)-1, parseInt(fd));
    currentDayBase.setHours(0, 0, 0, 0);

    // Determine target users to include (All filtered authorized users)
    const targetUsers = authorizedUsers.length > 0 ? authorizedUsers.filter(u => {
        let match = true;
        if (selectedJobs.length > 0) {
          const selLower = selectedJobs.map(j => j.toLowerCase());
          match = match && selLower.includes(u.jobTitle?.toString().trim().toLowerCase());
        }
        if (selectedEmployees.length > 0) {
          const selLower = selectedEmployees.map(e => e.toLowerCase());
          match = match && selLower.includes(u.fullName?.toString().trim().toLowerCase());
        }
        if (selectedBranches.length > 0) {
          const selLower = selectedBranches.map(b => b.toLowerCase());
          match = match && selLower.includes(u.defaultBranch?.toString().trim().toLowerCase());
        }
        return match;
    }) : [];

    const usersToProcess = targetUsers.length > 0 ? targetUsers : 
      Array.from(new Set(filteredRecords.map(r => r.name))).map(name => {
         const r = filteredRecords.find(x => x.name === name);
         return { fullName: name, jobTitle: r?.job || 'N/A', defaultBranch: r?.branch || 'N/A', serialNumber: r?.serialNumber || 'N/A' };
      });

    // Group records by user and date
    const dailyRecords: Record<string, Record<string, { firstIn?: any, lastOut?: any }>> = {};

    filteredRecords.forEach(r => {
      const userId = r.serialNumber && r.serialNumber !== 'undefined' ? r.serialNumber : r.name;
      const dateKey = getDateString(r.date);

      if (!dailyRecords[userId]) dailyRecords[userId] = {};
      if (!dailyRecords[userId][dateKey]) dailyRecords[userId][dateKey] = {};

      const currentDayData = dailyRecords[userId][dateKey];
      const recordTime = new Date(r.time).getTime();

      if (r.type === 'check-in') {
        if (!currentDayData.firstIn || recordTime < new Date(currentDayData.firstIn.time).getTime()) {
          currentDayData.firstIn = r;
        }
      } else if (r.type === 'check-out') {
        if (!currentDayData.lastOut || recordTime > new Date(currentDayData.lastOut.time).getTime()) {
          currentDayData.lastOut = r;
        }
      }
    });

    const detailedData: any[] = [];

    usersToProcess.forEach(u => {
      const userId = u.serialNumber && u.serialNumber !== 'undefined' ? u.serialNumber : u.fullName;
      const userJob = fetchedJobs.find(j => j.title === u.jobTitle);
      const workingDays = userJob?.workingDays || [0, 1, 2, 3, 4, 6]; // Default all except Friday

      const dayWalker = new Date(currentDayBase);
      while (true) {
        const dateKey = getDateString(dayWalker);
        if (dateKey > toDate) break;

        const dayData = dailyRecords[userId]?.[dateKey];
        
        const dayOfWeek = dayWalker.getDay();
        const isHoliday = fetchedHolidays.includes(dateKey);
        const isWorkingDay = workingDays.includes(dayOfWeek);

        // Find visit plan for this user and date
        const plan = visitPlans.find(p => {
          if (!p.date) return false;
          const pDateStr = getDateString(p.date);
          if (pDateStr !== dateKey) return false;

          // 2. User Matching
          const pUser = p.userId?.toString().trim();
          const pName = p.userName?.toString().trim().toLowerCase().replace(/\s+/g, '');
          const pSerial = p.userSerial?.toString().trim();
          const uId = u.id?.toString().trim();
          const uName = u.fullName?.toString().trim().toLowerCase().replace(/\s+/g, '');
          const uSerial = u.serialNumber?.toString().trim();

          const isValid = (val: any) => val && val !== 'N/A' && val !== 'undefined' && val !== '';

          return (
            (isValid(uId) && isValid(pUser) && pUser === uId) || 
            (isValid(uName) && isValid(pName) && pName === uName) || 
            (isValid(uSerial) && isValid(pSerial) && pSerial === uSerial) ||
            (isValid(uSerial) && isValid(pUser) && pUser === uSerial) ||
            (isValid(uName) && isValid(pUser) && pUser.toLowerCase().replace(/\s+/g, '') === uName) ||
            (isValid(uSerial) && isValid(pUser) && pUser.includes(uSerial)) ||
            (isValid(uName) && isValid(pName) && (pName.includes(uName) || uName.includes(pName)))
          );
        });

        const isPlanHoliday = plan?.branchName === 'Holiday';
        const isOffDay = isHoliday || !isWorkingDay || isPlanHoliday;

        // Show if it's a working day OR if there are records OR if there is a visit plan
        if (isWorkingDay || dayData || plan) {
          const firstIn = dayData?.firstIn;
          const lastOut = dayData?.lastOut;
          
          let inStatus = '';
          if (isOffDay) {
             inStatus = 'اجازة';
          } else if (firstIn) {
             const branchName = firstIn.branch?.toLowerCase() || '';
             const isExcludedBranch = branchName.includes('home') || branchName.includes('out door');
             if (!isExcludedBranch) {
                 inStatus = firstIn.timeDiff.includes('متأخر') ? 'متأخر' : (firstIn.timeDiff.includes('مبكر') ? 'مبكر' : 'طبيعي');
             } else {
                 inStatus = 'مستثنى';
             }
          } else if (isWorkingDay) {
             inStatus = 'لم يسجل';
          }

          let outStatus = '';
          if (isOffDay) {
             outStatus = 'اجازة';
          } else if (lastOut) {
             const branchName = lastOut.branch?.toLowerCase() || '';
             const isExcludedBranch = branchName.includes('home') || branchName.includes('out door');
             if (!isExcludedBranch) {
                 outStatus = lastOut.timeDiff.includes('مبكر') ? 'مبكر' : (lastOut.timeDiff.includes('متأخر') ? 'متأخر' : 'طبيعي');
             } else {
                 outStatus = 'مستثنى';
             }
          } else if (isWorkingDay) {
             outStatus = 'لم يسجل';
          }

          detailedData.push({
            'الرقم التسلسلي': u.serialNumber || 'N/A',
            'اسم الموظف': u.fullName,
            'اليوم': dateKey,
            'الخطة': plan ? (plan.branchName || plan.branch || 'خطة موجودة') : 'لا توجد خطة',
            'وقت الحضور': firstIn ? new Date(firstIn.time).toLocaleTimeString('en-US') : 'لم يسجل',
            'كود فرع الحضور': firstIn ? getBranchCode(firstIn.branch, firstIn) : '',
            'فرع الحضور': firstIn ? firstIn.branch : '',
            'حالة الحضور': inStatus,
            'وقت الانصراف': lastOut ? new Date(lastOut.time).toLocaleTimeString('en-US') : 'لم يسجل',
            'كود فرع الانصراف': lastOut ? getBranchCode(lastOut.branch, lastOut) : '',
            'فرع الانصراف': lastOut ? lastOut.branch : '',
            'حالة الانصراف': outStatus
          });
        }
        dayWalker.setDate(dayWalker.getDate() + 1);
      }
    });

    // Sort by Date then Name
    detailedData.sort((a, b) => {
      if (a['اليوم'] === b['اليوم']) {
        return a['اسم الموظف'].localeCompare(b['اسم الموظف']);
      }
      return a['اليوم'].localeCompare(b['اليوم']);
    });

    const ws = XLSX.utils.json_to_sheet(detailedData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Detailed Report");
    logAction?.('تحميل تقرير (Detailed)', `الفترة: ${fromDate} إلى ${toDate}`);
    XLSX.writeFile(wb, `Detailed_${username}_${fromDate}_to_${toDate}.xlsx`);
  };

  const availableJobs = useMemo(() => {
    const all = [...records.map(r => r.job), ...authorizedUsers.map(u => u.jobTitle)]
      .map(j => j?.toString().trim().replace(/\s+/g, ' '))
      .filter(Boolean);
    const unique = new Map();
    all.forEach(j => {
      const key = j.toLowerCase().replace(/[^\w\s\u0600-\u06FF]/g, '');
      if (!unique.has(key)) unique.set(key, j);
    });
    return Array.from(unique.values()).sort();
  }, [records, authorizedUsers]);

  const availableEmployees = useMemo(() => {
    const all = [...records.map(r => r.name), ...authorizedUsers.map(u => u.fullName)]
      .map(n => n?.toString().trim().replace(/\s+/g, ' '))
      .filter(Boolean);
    const unique = new Map();
    all.forEach(n => {
      const key = n.toLowerCase().replace(/[^\w\s\u0600-\u06FF]/g, '');
      if (!unique.has(key)) unique.set(key, n);
    });
    return Array.from(unique.values()).sort();
  }, [records, authorizedUsers]);
  
  const availableBranches = useMemo(() => {
     const all = [...records.map(r => r.branch), ...authorizedUsers.map(u => u.defaultBranch)]
       .map(b => b?.toString().trim().replace(/\s+/g, ' '))
       .filter(Boolean);
     const unique = new Map();
     all.forEach(b => {
       const key = b.toLowerCase().replace(/[^\w\s\u0600-\u06FF]/g, '');
       if (!unique.has(key)) unique.set(key, b);
     });
     return Array.from(unique.values()).sort();
  }, [records, authorizedUsers]);

  /**
   * خريطة: اسم الفرع ← كوده.
   * تُغذّي البحث في فلتر الفروع، فيجد الموظف الفرع باسمه أو بكود توكيله.
   * تُبنى من قائمة الفروع المعتمدة، وتُكمَّل من السجلات للفروع التي تحمل
   * كوداً في سجلّ الحضور ولم تعد موجودة في القائمة.
   */
  const branchCodeByName = useMemo(() => {
    const map: Record<string, string> = {};
    fetchedBranches.forEach(b => {
      const name = b?.name?.toString().trim();
      const code = b?.code?.toString().trim();
      if (name && code) map[name] = code;
    });
    records.forEach(r => {
      const name = r?.branch?.toString().trim();
      const code = r?.branchCode?.toString().trim();
      if (name && code && !map[name]) map[name] = code;
    });
    return map;
  }, [fetchedBranches, records]);

  const filteredRecords = useMemo(() => records.filter(r => {
    if (!r.date) return false;
    const d = new Date(r.date);
    if (isNaN(d.getTime())) return false;
    const rdStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    
    let m = true; 
    if (fromDate) m = m && rdStr >= fromDate;
    if (toDate) m = m && rdStr <= toDate;
    
    if (selectedJobs.length > 0) {
      const selLower = selectedJobs.map(j => j.toLowerCase());
      m = m && selLower.includes(r.job?.toString().trim().toLowerCase());
    }
    if (selectedEmployees.length > 0) {
      const selLower = selectedEmployees.map(e => e.toLowerCase());
      m = m && selLower.includes(r.name?.toString().trim().toLowerCase());
    }
    if (selectedBranches.length > 0) {
      const selLower = selectedBranches.map(b => b.toLowerCase());
      m = m && selLower.includes(r.branch?.toString().trim().toLowerCase());
    }
    return m; 
  }), [records, fromDate, toDate, selectedJobs, selectedEmployees, selectedBranches]);

  /**
   * صفوف لوحة الالتزام.
   *
   * buildSummary تمرّ على كل موظف × كل يوم في الفترة وتبحث في خطط الزيارات،
   * وكانت تُستدعى داخل الـ render مباشرةً فتُعاد بالكامل عند كل ضغطة مفتاح
   * في حقل بحث اللوحة. التذكير هنا يقصرها على تغيّر مدخلاتها الفعلية.
   */
  const dashboardRows = useMemo(
    () => buildSummary(true),
    [records, authorizedUsers, visitPlans, fetchedJobs, fetchedBranches, fetchedHolidays,
     fromDate, toDate, selectedJobs, selectedEmployees, selectedBranches]
  );

  const toggleJobSelection = (val: string) => setSelectedJobs(prev => prev.includes(val) ? prev.filter(x => x !== val) : [...prev, val]);
  const toggleEmployeeSelection = (val: string) => setSelectedEmployees(prev => prev.includes(val) ? prev.filter(x => x !== val) : [...prev, val]);
  const toggleBranchSelection = (val: string) => setSelectedBranches(prev => prev.includes(val) ? prev.filter(x => x !== val) : [...prev, val]);

  if (!isLoggedIn) {
    if (autoLoginAdmin) {
      return (
        <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
          <div className="w-16 h-16 rounded-2xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400 mb-4 shadow-lg shadow-blue-900/20">
            <Loader2 className="animate-spin" size={32} />
          </div>
          <h3 className="text-white font-black text-base">جاري استعراض التقارير...</h3>
          <p className="text-slate-400 text-xs mt-1">يتم التحميل المباشر بصلاحية المسؤول</p>
          {error && (
            <div className="mt-4 p-4 bg-red-900/30 border border-red-500/50 rounded-2xl text-red-300 text-xs font-bold max-w-md flex flex-col items-center gap-3">
              <div className="flex items-center gap-2">
                <AlertCircle size={18} className="text-red-400 shrink-0" />
                <span>{error}</span>
              </div>
              <button 
                type="button" 
                onClick={() => {
                  const adminUser = adminConfig?.adminUsername || 'admin';
                  const adminPass = adminConfig?.adminPassword || 'Ba522129';
                  fetchData(true, adminUser, adminPass);
                }}
                className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-xl text-xs font-black shadow-lg cursor-pointer transition-all active:scale-95 flex items-center gap-2"
              >
                <RefreshCw size={14} />
                <span>إعادة المحاولة</span>
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
            <h2 className="text-2xl font-black text-white uppercase tracking-tighter">Reports Access</h2>
            <p className="text-slate-500 text-[10px] font-black uppercase mt-1">نظام متابعة التقارير والوظائف</p>
          </div>
          <form onSubmit={(e) => {e.preventDefault(); fetchData();}} className="space-y-4">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-white mr-2 uppercase tracking-widest">اسم المستخدم</label>
              <input type="text" className="w-full bg-slate-900 border border-slate-700 text-white px-5 py-3.5 rounded-2xl font-bold outline-none focus:border-blue-500 transition-all shadow-inner" value={username} onChange={e => setUsername(e.target.value)} />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-white mr-2 uppercase tracking-widest">كلمة المرور</label>
              <div className="relative">
                <input 
                  type={showPassword ? "text" : "password"} 
                  className="w-full bg-slate-900 border border-slate-700 text-white pl-12 pr-5 py-3.5 rounded-2xl font-bold outline-none focus:border-blue-500 transition-all shadow-inner" 
                  value={password} 
                  onChange={e => setPassword(e.target.value)} 
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition-colors"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>
            {error && (
              <div className="p-3 bg-red-900/20 border border-red-500/50 rounded-xl text-red-400 text-[10px] font-bold flex gap-2 items-center">
                <AlertCircle size={16} /><span>{error}</span>
              </div>
            )}
            <button disabled={isLoading} type="submit" className="w-full bg-blue-600 hover:bg-blue-500 text-white py-4 rounded-2xl font-black shadow-xl flex items-center justify-center gap-2 transition-all active:scale-95">
              {isLoading ? <Loader2 className="animate-spin" size={20} /> : <LogIn size={20} />}
              دخول واستعراض التقارير
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-center gap-4 bg-slate-800 p-4 md:p-6 rounded-3xl border border-slate-700 shadow-xl">
        <div className="text-right w-full md:w-auto"><h2 className="text-xl font-black text-blue-400 flex items-center gap-2">{isAdminLogin ? <ShieldCheck size={24} className="text-orange-400" /> : <Table size={24} />} متابعة التقارير والوظائف {isAdminLogin && <span className="text-[10px] text-orange-400 bg-orange-400/10 px-2 py-0.5 rounded-lg border border-orange-400/20 mr-2">Admin Mode</span>}</h2><p className="text-slate-500 text-[10px] font-black uppercase">المسؤول: {username}</p></div>
        <div className="flex flex-wrap gap-2 justify-center items-center">
          <div className="flex gap-1">
            <button type="button" onClick={exportToExcel} className="flex items-center gap-2 px-4 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-2xl font-black text-[10px] shadow-xl transition-all border border-slate-600">
              <Download size={14} /> All Data
            </button>
            <button type="button" onClick={exportSummaryExcel} className="flex items-center gap-2 px-4 py-3 bg-green-600 hover:bg-green-500 text-white rounded-2xl font-black text-[10px] shadow-xl transition-all">
              <FileSpreadsheet size={14} /> Summary Data
            </button>
            <button type="button" onClick={exportDetailedExcel} className="flex items-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-2xl font-black text-[10px] shadow-xl transition-all">
              <Table size={14} /> Detailed Data
            </button>
          </div>
        </div>
      </div>
      
      <div className="bg-slate-800 p-4 md:p-6 rounded-3xl border border-slate-700 shadow-lg space-y-6">
        <div className="flex justify-between items-center border-b border-slate-700 pb-4">
          <h3 className="text-xs font-black text-white flex items-center gap-2 uppercase tracking-widest text-right"><Filter size={14} /> تصفية السجلات قبل التحميل</h3>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <CustomDatePicker label="من تاريخ" value={fromDate} onChange={setFromDate} placeholder="اختر البداية" />
          <CustomDatePicker label="إلى تاريخ" value={toDate} onChange={setToDate} placeholder="اختر النهاية" />
          
          <MultiSelect 
            label="تصفية بالوظائف" 
            options={availableJobs} 
            selected={selectedJobs} 
            onToggle={toggleJobSelection} 
            placeholder="الكل" 
            icon={Briefcase} 
          />
          
          <MultiSelect 
            label="تصفية بالموظفين" 
            options={availableEmployees} 
            selected={selectedEmployees} 
            onToggle={toggleEmployeeSelection} 
            placeholder="الكل" 
            icon={UserIcon} 
          />

          <MultiSelect
            label="تصفية بالفروع"
            options={availableBranches}
            selected={selectedBranches}
            onToggle={toggleBranchSelection}
            placeholder="الكل"
            icon={MapPin}
            aliases={branchCodeByName}
          />

          <div className="flex items-end">
            <button type="button" onClick={() => { setFromDate(''); setToDate(''); setSelectedJobs([]); setSelectedEmployees([]); setSelectedBranches([]); }} className="w-full px-4 py-2.5 bg-slate-700/50 hover:bg-slate-700 text-white rounded-xl text-[10px] font-black uppercase transition-all flex justify-center items-center gap-2 border border-slate-700">
              <X size={14} /> مسح جميع الفلاتر
            </button>
          </div>
        </div>
      </div>

      {/* ==================== لوحة الالتزام التفاعلية ==================== */}
      {(() => {
        const rows = dashboardRows;
        if (!rows || rows.length === 0) {
          return (
            <div className="bg-slate-800 p-5 md:p-8 rounded-3xl border border-slate-700 shadow-lg text-center">
              <BarChart3 size={30} className="mx-auto text-slate-600 mb-3" />
              <div className="text-white text-sm font-black mb-1">لوحة الالتزام</div>
              <div className="text-slate-500 text-[11px] font-bold">
                حدّد «من تاريخ» و«إلى تاريخ» أعلاه لعرض ملخّص التزام الموظفين
              </div>
            </div>
          );
        }

        const num = (v: any) => Number(v) || 0;
        const hmToMin = (s: any) => {
          const [h, m] = String(s || '0:0').split(':').map((x: string) => parseInt(x, 10) || 0);
          return h * 60 + m;
        };
        const minToHm = (t: number) => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;

        const totWork = rows.reduce((a, r) => a + num(r['عدد أيام العمل المتاحة']), 0);
        const totAtt  = rows.reduce((a, r) => a + num(r['عدد أيام الحضور']), 0);
        const totAbs  = rows.reduce((a, r) => a + num(r['عدد أيام الغياب']), 0);
        const totLate = rows.reduce((a, r) => a + num(r['عدد أيام الحضور متأخر']), 0);
        const totEarly= rows.reduce((a, r) => a + num(r['عدد أيام الانصراف المبكر']), 0);
        const lateMin = rows.reduce((a, r) => a + hmToMin(r['ساعات الحضور المتأخر']), 0);
        const otMin   = rows.reduce((a, r) => a + hmToMin(r['ساعات الانصراف المتأخر (الإضافي)']), 0);
        const rate    = totWork > 0 ? Math.round((totAtt / totWork) * 100) : 0;

        const rateOf = (r: any) => {
          const w = num(r['عدد أيام العمل المتاحة']);
          return w > 0 ? Math.round((num(r['عدد أيام الحضور']) / w) * 100) : 0;
        };
        const ranked = [...rows].sort((a, b) => rateOf(b) - rateOf(a));
        const single = ranked.length === 1 ? ranked[0] : null;

        const highCount = ranked.filter(r => rateOf(r) >= 90).length;
        const medCount  = ranked.filter(r => rateOf(r) >= 75 && rateOf(r) < 90).length;
        const lowCount  = ranked.filter(r => rateOf(r) < 75).length;
        const topPerformer = ranked.length > 0 ? ranked[0] : null;

        const filteredRanked = ranked.filter(r => {
          const pr = rateOf(r);
          let passFilter = true;
          if (dashFilter === 'high') passFilter = pr >= 90;
          else if (dashFilter === 'med') passFilter = pr >= 75 && pr < 90;
          else if (dashFilter === 'low') passFilter = pr < 75;

          if (!passFilter) return false;

          if (!dashSearch.trim()) return true;
          const q = dashSearch.toLowerCase().trim();
          const empName = String(r['اسم الموظف'] || '').toLowerCase();
          const jobTitle = String(r['الوظيفة'] || '').toLowerCase();
          const branchName = String(r['اسم الفرع'] || '').toLowerCase();
          const branchCode = String(r['كود الفرع'] || '').toLowerCase();
          const serialNum = String(r['الرقم التسلسلي'] || '').toLowerCase();
          return empName.includes(q) || jobTitle.includes(q) || branchName.includes(q) || branchCode.includes(q) || serialNum.includes(q);
        });

        const KPI = ({ label, value, unit, tone, icon: Ico }: any) => (
          <div className="bg-slate-900/50 border border-slate-700/80 rounded-2xl p-4 transition-all hover:border-slate-600">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{label}</span>
              <Ico size={15} style={{ color: tone }} />
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-black text-white" style={{ direction: 'ltr' }}>{value}</span>
              {unit && <span className="text-[10px] font-bold text-slate-400">{unit}</span>}
            </div>
          </div>
        );

        return (
          <div className="bg-slate-800 rounded-3xl border border-slate-700 shadow-xl overflow-hidden">
            <div className="ut-accent-bar" />

            <div className="p-4 md:p-6 space-y-6">
              <div className="flex flex-wrap justify-between items-center gap-3 border-b border-slate-700 pb-4">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-blue-600/20 text-blue-400 flex items-center justify-center border border-blue-500/30">
                    <BarChart3 size={18} />
                  </div>
                  <div>
                    <h3 className="text-sm font-black text-white uppercase tracking-wider">
                      لوحة الالتزام والمتابعة الذكية
                    </h3>
                    <p className="text-[10px] text-slate-400 font-bold">تحليل مؤشرات الأداء ونسب الحضور والغياب</p>
                  </div>
                </div>
                <span className="ut-chip ut-chip--brand">
                  {fromDate} — {toDate} · {rows.length} موظف
                </span>
              </div>

              {/* ===== المؤشرات الرئيسية ===== */}
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
                <KPI label="نسبة الالتزام" value={rate} unit="%" tone="var(--el-400)" icon={TrendingUp} />
                <KPI label="أيام الحضور" value={totAtt} unit={`من ${totWork}`} tone="#34D399" icon={CheckCircle} />
                <KPI label="أيام الغياب" value={totAbs} unit="يوم" tone="#F87171" icon={X} />
                <KPI label="أيام التأخير" value={totLate} unit="يوم" tone="#FBBF24" icon={Clock} />
                <KPI label="ساعات التأخير" value={minToHm(lateMin)} unit="س:د" tone="#FBBF24" icon={Clock} />
                <KPI label="ساعات إضافية" value={minToHm(otMin)} unit="س:د" tone="#34D399" icon={TrendingUp} />
              </div>

              {/* ===== شريط التوزيع وشريط التميز ===== */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="lg:col-span-2 bg-slate-900/40 border border-slate-700/60 rounded-2xl p-4">
                  <div className="flex justify-between text-[10px] font-black text-slate-400 uppercase mb-2">
                    <span>توزيع أيام العمل المتاحة</span>
                    <span style={{ direction: 'ltr' }}>{totWork} يوم عمل</span>
                  </div>
                  <div className="flex h-3 rounded-full overflow-hidden bg-slate-950 p-0.5 border border-slate-800">
                    {[
                      { v: Math.max(0, totAtt - totLate), c: 'var(--grad-ok)' },
                      { v: totLate, c: 'var(--grad-warn)' },
                      { v: totAbs, c: 'var(--grad-bad)' }
                    ].map((s, i) => s.v > 0 && (
                      <div key={i} className="h-full rounded-sm" style={{ width: `${(s.v / Math.max(1, totWork)) * 100}%`, backgroundImage: s.c }} />
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-4 mt-3 text-[10px] font-bold">
                    <span className="flex items-center gap-1.5 text-slate-300"><i className="w-2.5 h-2.5 rounded-full inline-block bg-emerald-500 shadow-sm shadow-emerald-500/50" /> في الموعد ({Math.max(0, totAtt - totLate)})</span>
                    <span className="flex items-center gap-1.5 text-slate-300"><i className="w-2.5 h-2.5 rounded-full inline-block bg-amber-500 shadow-sm shadow-amber-500/50" /> متأخر ({totLate})</span>
                    <span className="flex items-center gap-1.5 text-slate-300"><i className="w-2.5 h-2.5 rounded-full inline-block bg-red-500 shadow-sm shadow-red-500/50" /> غياب ({totAbs})</span>
                    <span className="flex items-center gap-1.5 text-slate-300"><i className="w-2.5 h-2.5 rounded-full inline-block bg-blue-500 shadow-sm shadow-blue-500/50" /> انصراف مبكر ({totEarly})</span>
                  </div>
                </div>

                {topPerformer && (
                  <div className="bg-emerald-950/20 border border-emerald-500/30 rounded-2xl p-4 flex flex-col justify-between">
                    <div className="flex items-center justify-between text-[10px] font-black text-emerald-400 uppercase tracking-widest mb-1">
                      <span>الأبرز التزاماً 🏆</span>
                      <span className="bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-md font-bold">{rateOf(topPerformer)}%</span>
                    </div>
                    <div>
                      <div className="text-white text-sm font-black truncate">{topPerformer['اسم الموظف']}</div>
                      <div className="text-[10px] font-bold text-slate-400 truncate mt-0.5">
                        {topPerformer['الوظيفة']} · {topPerformer['اسم الفرع']}
                      </div>
                    </div>
                    <div className="text-[10px] text-slate-400 font-bold mt-2 pt-2 border-t border-emerald-900/40 flex justify-between">
                      <span>حضور: {topPerformer['عدد أيام الحضور']} يوم</span>
                      <span>تأخير: {topPerformer['عدد أيام الحضور متأخر']} يوم</span>
                    </div>
                  </div>
                )}
              </div>

              {/* ===== بطاقة الموظف المفرد ===== */}
              {single && (
                <div className="rounded-2xl p-5 border bg-blue-950/20 border-blue-500/40">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-white text-base font-black">{single['اسم الموظف']}</div>
                      <div className="text-[11px] font-bold text-slate-400 mt-1">
                        {single['الوظيفة']} · {single['اسم الفرع']}
                      </div>
                    </div>
                    <div className="text-left">
                      <div className="text-2xl md:text-3xl font-black" style={{ color: rateOf(single) >= 90 ? '#34D399' : rateOf(single) >= 75 ? '#FBBF24' : '#F87171', direction: 'ltr' }}>
                        {rateOf(single)}%
                      </div>
                      <div className="text-[10px] font-black text-slate-400 uppercase">نسبة الالتزام</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
                    {[
                      ['أيام الحضور', single['عدد أيام الحضور']],
                      ['أيام الغياب', single['عدد أيام الغياب']],
                      ['أيام التأخير', single['عدد أيام الحضور متأخر']],
                      ['ساعات التأخير', single['ساعات الحضور المتأخر']]
                    ].map(([l, v]: any) => (
                      <div key={l} className="bg-slate-900/50 rounded-xl p-3 text-center">
                        <div className="text-white text-lg font-black" style={{ direction: 'ltr' }}>{v}</div>
                        <div className="text-[9px] font-black text-slate-400 uppercase mt-1">{l}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ===== شريط البحث والتصفية للوحة الالتزام ===== */}
              {!single && (
                <div className="space-y-4 pt-2">
                  <div className="flex flex-col md:flex-row gap-3 justify-between items-stretch md:items-center bg-slate-900/60 p-3 rounded-2xl border border-slate-700/60">
                    {/* حقل البحث السريع */}
                    <div className="relative flex-1">
                      <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="text"
                        value={dashSearch}
                        onChange={(e) => setDashSearch(e.target.value)}
                        placeholder="ابحث باسم الموظف، الوظيفة، أو الفرع..."
                        className="w-full bg-slate-800 text-white pr-9 pl-8 py-2 rounded-xl text-xs font-bold border border-slate-700 focus:outline-none focus:border-blue-500 placeholder:text-slate-500"
                      />
                      {dashSearch && (
                        <button
                          type="button"
                          onClick={() => setDashSearch('')}
                          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>

                    {/* تبويبات الفلترة السريعة */}
                    <div className="flex flex-wrap gap-1.5 text-xs font-bold">
                      <button
                        type="button"
                        onClick={() => setDashFilter('all')}
                        className={`px-3 py-1.5 rounded-xl transition-all cursor-pointer ${dashFilter === 'all' ? 'bg-blue-600 text-white font-black shadow-md' : 'bg-slate-800 text-slate-400 hover:text-white border border-slate-700'}`}
                      >
                        الكل ({ranked.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setDashFilter('high')}
                        className={`px-3 py-1.5 rounded-xl transition-all cursor-pointer ${dashFilter === 'high' ? 'bg-emerald-600 text-white font-black shadow-md' : 'bg-slate-800 text-emerald-400 hover:bg-emerald-950/30 border border-slate-700'}`}
                      >
                        ممتاز 90%+ ({highCount})
                      </button>
                      <button
                        type="button"
                        onClick={() => setDashFilter('med')}
                        className={`px-3 py-1.5 rounded-xl transition-all cursor-pointer ${dashFilter === 'med' ? 'bg-amber-600 text-white font-black shadow-md' : 'bg-slate-800 text-amber-400 hover:bg-amber-950/30 border border-slate-700'}`}
                      >
                        متوسط 75-89% ({medCount})
                      </button>
                      <button
                        type="button"
                        onClick={() => setDashFilter('low')}
                        className={`px-3 py-1.5 rounded-xl transition-all cursor-pointer ${dashFilter === 'low' ? 'bg-red-600 text-white font-black shadow-md' : 'bg-slate-800 text-red-400 hover:bg-red-950/30 border border-slate-700'}`}
                      >
                        يحتاج متابعة ({lowCount})
                      </button>
                    </div>
                  </div>

                  {/* ===== جدول الالتزام المطوّر ===== */}
                  <div className="overflow-x-auto rounded-2xl border border-slate-700/80">
                    <table className="w-full text-right min-w-[720px]">
                      <thead>
                        <tr className="bg-slate-900/80 border-b border-slate-700 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                          <th className="py-3.5 px-3 text-center w-12">#</th>
                          <th className="py-3.5 px-3 text-right">الموظف</th>
                          <th className="py-3.5 px-3 text-center">الحضور</th>
                          <th className="py-3.5 px-3 text-center">الغياب</th>
                          <th className="py-3.5 px-3 text-center">التأخير</th>
                          <th className="py-3.5 px-3 text-center">ساعات التأخير</th>
                          <th className="py-3.5 px-3 text-center w-48">مؤشر الالتزام</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-700/40">
                        {filteredRanked.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="py-8 text-center text-slate-400 text-xs font-bold bg-slate-900/20">
                              لا توجد نتائج تطابق خيارات البحث أوالفلتر الحالية
                            </td>
                          </tr>
                        ) : (
                          filteredRanked.map((r, i) => {
                            const pr = rateOf(r);
                            const col = pr >= 90 ? 'var(--ok)' : pr >= 75 ? 'var(--warn)' : 'var(--bad)';
                            const originalRank = ranked.findIndex(x => x['اسم الموظف'] === r['اسم الموظف']) + 1;

                            return (
                              <tr key={i} className="hover:bg-slate-900/50 transition-colors">
                                <td data-label="الترتيب" className="py-3 px-3 text-center font-black text-xs text-slate-500">
                                  {originalRank === 1 ? '🥇' : originalRank === 2 ? '🥈' : originalRank === 3 ? '🥉' : originalRank}
                                </td>
                                <td data-label="الموظف" className="py-3 px-3">
                                  <div className="text-white text-xs font-black">{r['اسم الموظف']}</div>
                                  <div className="text-[10px] text-slate-400 font-bold mt-0.5">{r['الوظيفة']} · {r['اسم الفرع']}</div>
                                </td>
                                <td data-label="الحضور" className="py-3 px-3 text-center text-xs font-black text-slate-300" style={{ direction: 'ltr' }}>
                                  {r['عدد أيام الحضور']}<span className="text-slate-500">/{r['عدد أيام العمل المتاحة']}</span>
                                </td>
                                <td data-label="الغياب" className="py-3 px-3 text-center text-xs font-black" style={{ color: num(r['عدد أيام الغياب']) > 0 ? '#F87171' : '#475569' }}>
                                  {r['عدد أيام الغياب']}
                                </td>
                                <td data-label="التأخير" className="py-3 px-3 text-center text-xs font-black" style={{ color: num(r['عدد أيام الحضور متأخر']) > 0 ? '#FBBF24' : '#475569' }}>
                                  {r['عدد أيام الحضور متأخر']}
                                </td>
                                <td data-label="ساعات التأخير" className="py-3 px-3 text-center text-[11px] font-black text-slate-300" style={{ direction: 'ltr' }}>
                                  {r['ساعات الحضور المتأخر']}
                                </td>
                                <td data-label="مؤشر الالتزام" className="py-3 px-3">
                                  <div className="flex items-center gap-2">
                                    <div className="flex-1 h-2 rounded-full bg-slate-950 overflow-hidden p-0.5 border border-slate-800">
                                      <div className="h-full rounded-full transition-all duration-300" style={{ width: `${pr}%`, background: col }} />
                                    </div>
                                    <span className="text-[11px] font-black w-10 text-left" style={{ color: col, direction: 'ltr' }}>{pr}%</span>
                                  </div>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })()}

    </div>
  );
}
