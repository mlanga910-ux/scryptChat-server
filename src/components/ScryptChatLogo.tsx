import React from 'react';

interface ScryptChatLogoProps {
  className?: string;
  size?: number;
  showText?: boolean;
}

export const ScryptChatLogo: React.FC<ScryptChatLogoProps> = ({
  className = '',
  size = 28,
  showText = false,
}) => {
  return (
    <div className={`inline-flex items-center gap-2 select-none ${className}`}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 512 512"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="shrink-0 drop-shadow-sm"
      >
        <rect width="512" height="512" rx="96" fill="#000000" />
        
        {/* Left glitch accent dashes and dots */}
        <line x1="55" y1="185" x2="110" y2="185" stroke="#ffffff" strokeWidth="12" strokeLinecap="square" />
        <line x1="38" y1="205" x2="95" y2="205" stroke="#ffffff" strokeWidth="10" strokeLinecap="square" />
        <line x1="68" y1="225" x2="105" y2="225" stroke="#ffffff" strokeWidth="10" strokeLinecap="square" />
        <rect x="55" y="245" width="12" height="12" fill="#ffffff" />
        <rect x="75" y="245" width="12" height="12" fill="#ffffff" />
        <rect x="42" y="265" width="12" height="12" fill="#ffffff" />

        {/* Right glitch accent bars and column dots */}
        <line x1="395" y1="120" x2="445" y2="120" stroke="#ffffff" strokeWidth="12" strokeLinecap="square" />
        <line x1="410" y1="138" x2="465" y2="138" stroke="#ffffff" strokeWidth="10" strokeLinecap="square" />
        <rect x="415" y="156" width="12" height="12" fill="#ffffff" />
        <rect x="415" y="174" width="12" height="12" fill="#ffffff" />
        <rect x="415" y="192" width="12" height="12" fill="#ffffff" />
        <rect x="415" y="210" width="12" height="12" fill="#ffffff" />
        <rect x="435" y="192" width="12" height="12" fill="#ffffff" />

        {/* Stylized Angular Speech Bubble */}
        <path
          d="M 160 55 L 352 55 L 405 108 L 405 270 L 352 323 L 200 323 L 155 372 L 155 323 L 110 323 L 57 270 L 57 108 Z"
          fill="none"
          stroke="#ffffff"
          strokeWidth="22"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Stylized Cyber Central 'S' with diagonal cuts */}
        <path d="M 330 115 L 210 115 L 140 185 L 260 185 L 305 140 Z" fill="#ffffff" />
        <path d="M 185 185 L 325 185 L 325 210 L 185 210 Z" fill="#ffffff" />
        <path d="M 182 280 L 302 280 L 372 210 L 252 210 L 207 255 Z" fill="#ffffff" />
      </svg>
      {showText && (
        <span className="tracking-tight font-bold text-white text-base font-sans">
          scrypt<span className="text-zinc-400 font-normal">Chat</span>
        </span>
      )}
    </div>
  );
};
