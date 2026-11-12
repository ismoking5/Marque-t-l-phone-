import { useState } from 'react';
import { Smartphone } from 'lucide-react';

export function BrandEmblem({
  sizeClass = 'w-12 h-12 sm:w-14 sm:h-14',
  shape = 'circle',
}: {
  sizeClass?: string;
  shape?: 'circle' | 'square';
}) {
  const radiusClass = shape === 'circle' ? 'rounded-full' : 'rounded-lg';

  return (
    <div
      className={`relative ${sizeClass} ${radiusClass} p-0.5 bg-gradient-to-tr from-[#A67C00] via-[#F5C533] to-[#D4AF37] shadow-2xs shrink-0 select-none`}
    >
      <div
        className={`w-full h-full ${radiusClass} bg-gradient-to-b from-[#1E293B] via-[#0F172A] to-[#020617] flex flex-col items-center justify-center overflow-hidden relative`}
      >
        <svg
          viewBox="0 0 64 64"
          className="w-[78%] h-[78%] drop-shadow-2xs"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          {/* Titanium flagship phone silhouette */}
          <rect
            x="17"
            y="7"
            width="30"
            height="50"
            rx="6"
            fill="#0F172A"
            stroke="#F5C533"
            strokeWidth="2.4"
          />
          {/* Subtle OLED bezel glow */}
          <rect x="20.5" y="11" width="23" height="42" rx="3.5" fill="#1E293B" />
          {/* Camera precision island / triple lens detail */}
          <rect
            x="22.5"
            y="13.5"
            width="12"
            height="14"
            rx="3"
            fill="#090D16"
            stroke="#D4AF37"
            strokeWidth="1.2"
          />
          <circle cx="26.2" cy="17.5" r="2.1" fill="#F5C533" />
          <circle cx="26.2" cy="23.5" r="2.1" fill="#94A3B8" />
          <circle cx="31.2" cy="20.5" r="1.9" fill="#CBD5E1" />
          {/* Metallic chamfer highlight */}
          <path
            d="M24 38L32 30L40 38"
            stroke="#F5C533"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M27 44H37"
            stroke="#94A3B8"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      </div>
    </div>
  );
}

export function BrandLogo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 select-none">
      <BrandEmblem sizeClass="w-12 h-12 sm:w-14 sm:h-14" shape="circle" />
      <div className="flex flex-col">
        <div className="flex items-end gap-1.5">
          <div className="leading-[0.95] tracking-tight">
            <span className="block text-lg sm:text-xl font-extrabold text-[#0F172A] font-display">
              AURELIA
            </span>
            <span className="block text-lg sm:text-xl font-extrabold text-[#9A6B00] font-display">
              MOBILE
            </span>
          </div>
          <svg
            viewBox="0 0 38 34"
            className="w-7 h-7 sm:w-8 sm:h-8 mb-0.5 shrink-0"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <path
              d="M3 22L14 14L21 17L33 4M33 4H25M33 4V12"
              stroke="#D4AF37"
              strokeWidth="2.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <rect x="8" y="21" width="5" height="11" rx="1" fill="#334155" />
            <rect x="17" y="16" width="5" height="16" rx="1" fill="#B4860B" />
            <rect x="26" y="10" width="5" height="22" rx="1" fill="#F5C533" />
          </svg>
        </div>
        {!compact && (
          <p className="text-[11px] sm:text-xs italic font-medium text-[#475569] tracking-tight mt-0.5">
            L&apos;excellence du smartphone, le rendement au quotidien.
          </p>
        )}
      </div>
    </div>
  );
}

export function SafeImage({
  src,
  alt,
  className = '',
}: {
  src?: string;
  alt: string;
  className?: string;
}) {
  const [hasError, setHasError] = useState(false);

  if (hasError || !src) {
    return (
      <div
        className={`bg-gradient-to-br from-[#0F172A] via-[#1E293B] to-[#334155] flex flex-col items-center justify-center text-white p-4 ${className}`}
      >
        <Smartphone className="w-8 h-8 text-[#F5C533] mb-1.5 opacity-90" />
        <span className="text-xs font-medium text-center text-slate-200 line-clamp-2">
          {alt}
        </span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => setHasError(true)}
      className={className}
    />
  );
}
