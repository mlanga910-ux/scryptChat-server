import React from 'react';

interface AvatarProps {
  name?: string;
  avatarUrl?: string;
  avatarColor?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  isOnline?: boolean;
  showBadge?: boolean;
  className?: string;
  onClick?: (e: React.MouseEvent) => void;
}

const SIZE_CLASSES = {
  xs: 'w-6 h-6 text-[10px] rounded-lg',
  sm: 'w-8 h-8 text-xs rounded-xl',
  md: 'w-10 h-10 text-xs font-semibold rounded-xl',
  lg: 'w-12 h-12 text-sm font-bold rounded-2xl',
  xl: 'w-16 h-16 text-xl font-bold rounded-2xl',
  '2xl': 'w-24 h-24 text-3xl font-bold rounded-3xl',
};

const BADGE_SIZES = {
  xs: 'w-2 h-2 -bottom-0.5 -right-0.5 border',
  sm: 'w-2.5 h-2.5 -bottom-0.5 -right-0.5 border-2',
  md: 'w-3 h-3 -bottom-0.5 -right-0.5 border-2',
  lg: 'w-3.5 h-3.5 bottom-0 right-0 border-2',
  xl: 'w-4 h-4 bottom-0.5 right-0.5 border-2',
  '2xl': 'w-5 h-5 bottom-1 right-1 border-2',
};

export const Avatar: React.FC<AvatarProps> = ({
  name = 'User',
  avatarUrl,
  avatarColor = '#2563eb',
  size = 'md',
  isOnline,
  showBadge = false,
  className = '',
  onClick,
}) => {
  const initial = (name.trim() || 'U').charAt(0).toUpperCase();
  const sizeClass = SIZE_CLASSES[size] || SIZE_CLASSES.md;
  const badgeClass = BADGE_SIZES[size] || BADGE_SIZES.md;

  return (
    <div
      onClick={onClick}
      className={`relative shrink-0 select-none transition-transform ${onClick ? 'cursor-pointer' : ''} ${className}`}
    >
      <div
        className={`${sizeClass} overflow-hidden flex items-center justify-center text-white font-sans shadow-sm transition-all`}
        style={{ backgroundColor: avatarUrl ? '#18181b' : avatarColor }}
      >
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt={name}
            className="w-full h-full object-cover"
            onError={(e) => {
              (e.target as HTMLElement).style.display = 'none';
            }}
          />
        ) : (
          <span>{initial}</span>
        )}
      </div>

      {showBadge && (
        <div
          className={`absolute rounded-full border-[#0a0a0b] ${badgeClass} ${
            isOnline ? 'bg-emerald-400 ring-1 ring-emerald-400/50' : 'bg-zinc-600'
          }`}
          title={isOnline ? 'Online' : 'Offline'}
        />
      )}
    </div>
  );
};