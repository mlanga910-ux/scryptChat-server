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
    <div className={`inline-flex items-center gap-2.5 select-none ${className}`}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 512 512"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="shrink-0 drop-shadow-sm"
      >
        <rect width="512" height="512" rx="110" fill="#09090b" stroke="#27272a" strokeWidth="12" />
        
        {/* Glitch marks */}
        <line x1="60" y1="210" x2="120" y2="210" stroke="#ffffff" strokeWidth="8" strokeLinecap="square" />
        <line x1="45" y1="225" x2="105" y2="225" stroke="#ffffff" strokeWidth="6" strokeLinecap="square" />
        <line x1="75" y1="238" x2="115" y2="238" stroke="#ffffff" strokeWidth="6" strokeLinecap="square" />
        
        <line x1="390" y1="130" x2="425" y2="130" stroke="#ffffff" strokeWidth="8" strokeLinecap="square" />
        <line x1="380" y1="145" x2="445" y2="145" stroke="#ffffff" strokeWidth="8" strokeLinecap="square" />
        <line x1="395" y1="160" x2="415" y2="160" stroke="#ffffff" strokeWidth="6" strokeLinecap="square" />
        <line x1="395" y1="175" x2="415" y2="175" stroke="#ffffff" strokeWidth="6" strokeLinecap="square" />
        <line x1="395" y1="190" x2="415" y2="190" stroke="#ffffff" strokeWidth="6" strokeLinecap="square" />

        {/* Angular Tech Speech Bubble */}
        <path
          d="M 160 65 
             L 352 65 
             L 400 113 
             L 400 120 
             M 400 205
             L 400 320 
             L 352 368 
             L 205 368 
             L 190 425 
             L 182 425
             L 182 368
             L 160 368 
             L 112 320 
             L 112 250
             M 112 195
             L 112 113 
             Z"
          stroke="#ffffff"
          strokeWidth="18"
          strokeLinecap="square"
          strokeLinejoin="miter"
          fill="none"
        />

        {/* Angular 'S' Shape */}
        {/* Top bar & angle */}
        <polygon
          points="200,120 310,120 345,155 295,205 240,205 265,180 295,180 305,170 290,155 220,155 180,195 200,175"
          fill="#ffffff"
        />
        <polygon
          points="185,185 245,125 320,125 348,153 285,215 210,215"
          fill="#ffffff"
        />

        {/* Bottom bar & angle */}
        <polygon
          points="312,312 202,312 167,277 217,227 272,227 247,252 217,252 207,262 222,277 292,277 332,237 312,257"
          fill="#ffffff"
        />
        <polygon
          points="327,247 267,307 192,307 164,279 227,217 302,217"
          fill="#ffffff"
        />
      </svg>
      {showText && (
        <span className="font-mono tracking-tight font-bold text-white text-base">
          scrypt<span className="text-zinc-400 font-normal">Chat</span>
        </span>
      )}
    </div>
  );
};
