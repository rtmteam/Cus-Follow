import React from 'react';

/**
 * شعار Uniteam — صورة الهوية الرسمية.
 *
 * ملفان في public/ مشتقّان من الأيقونة الأصلية:
 *   logo-mark.png  العلامة وحدها (حرف U بلا نص) — للترويسة والأحجام الصغيرة
 *   logo.png       الأيقونة كاملة بكلمة UNITEAM — لشاشة الدخول والأحجام الكبيرة
 *
 * المسارات نسبية (./) لأن vite مضبوط على base: './' فيعمل البناء
 * من أي مجلد فرعي على GitHub Pages ومن داخل غلاف Capacitor على السواء.
 */

interface LogoMarkProps {
  size?: number;
  /** full = الأيقونة بنصّها · mark = العلامة وحدها */
  variant?: 'mark' | 'full';
  className?: string;
  /** إطار متوهّج حول الشعار */
  glow?: boolean;
}

export const LogoMark: React.FC<LogoMarkProps> = ({
  size = 40,
  variant = 'mark',
  className = '',
  glow = true
}) => (
  <img
    src={variant === 'full' ? './logo.png' : './logo-mark.png'}
    alt="Uniteam"
    width={size}
    height={size}
    className={className}
    style={{
      width: size,
      height: size,
      borderRadius: Math.round(size * 0.24),
      flex: 'none',
      display: 'block',
      objectFit: 'cover',
      boxShadow: glow ? '0 6px 22px rgba(37,99,235,.38)' : 'none'
    }}
  />
);

interface LogoProps {
  size?: number;
  tone?: 'dark' | 'light';
  showSub?: boolean;
  className?: string;
}

/** الشعار كاملاً: العلامة + الاسم بالخط المميّز */
const Logo: React.FC<LogoProps> = ({ size = 40, tone = 'dark', showSub = true, className = '' }) => (
  <div className={`flex items-center gap-2.5 ${className}`}>
    <LogoMark size={size} />
    <div className="leading-none">
      <div className="ut-brand" style={{ fontSize: Math.round(size * 0.46) }}>Uniteam</div>
      {showSub && (
        <div
          style={{
            fontSize: Math.max(9, Math.round(size * 0.24)),
            marginTop: 4,
            color: tone === 'dark' ? 'var(--on-dark-2)' : 'var(--tx-3)'
          }}
        >
          نظام الحضور والانصراف
        </div>
      )}
    </div>
  </div>
);

export default Logo;
