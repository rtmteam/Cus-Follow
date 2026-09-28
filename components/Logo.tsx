import React from 'react';

/**
 * شعار Cus-Follow — صورة الهوية الرسمية.
 *
 * ملفان في public/ مشتقّان من resources/icon.png (الأيقونة نفسها بمقاسين):
 *   logo-mark.png  128px — للترويسة (تُعرض 38px)
 *   logo.png       288px — لشاشة الدخول (تُعرض حتى 132px)
 *   كلاهما بلوحة 256 لوناً: 7KB و19KB بدل 58KB و165KB بلا فرق يُرى عند هذه المقاسات.
 *
 * الشعار يحمل نصّاً، فلم تُقتطع منه «علامة» منفصلة: أي قصّ يبتر الرسم أو النص.
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
    alt="Cus-Follow"
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
      boxShadow: glow ? '0 6px 22px rgba(45,181,44,.38)' : 'none'
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
      <div className="ut-brand" style={{ fontSize: Math.round(size * 0.46) }}>Cus-Follow</div>
      {showSub && (
        <div
          style={{
            fontSize: Math.max(9, Math.round(size * 0.24)),
            marginTop: 4,
            color: tone === 'dark' ? 'var(--on-dark-2)' : 'var(--tx-3)'
          }}
        >
          متابعة العملاء
        </div>
      )}
    </div>
  </div>
);

export default Logo;
