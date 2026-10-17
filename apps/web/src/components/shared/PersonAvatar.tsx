import type { Gender } from '@family-tree/shared';
import { cn } from '@family-tree/ui';

interface PersonAvatarProps {
  photoUrl: string | null;
  gender: Gender;
  name: string;
  isLiving?: boolean;
  size?: number;
  className?: string;
}

/**
 * A person's photo, or a placeholder portrait: a white ghutra with a black agal
 * for men, a black shayla for women. Deceased people get a muted ring.
 */
export function PersonAvatar({ photoUrl, gender, name, isLiving = true, size = 40, className }: PersonAvatarProps) {
  const ring = gender === 'FEMALE' ? 'var(--ft-female)' : gender === 'MALE' ? 'var(--ft-male)' : 'var(--ft-gold)';
  return (
    <span
      className={cn(
        'relative inline-flex shrink-0 overflow-hidden rounded-full bg-muted',
        !isLiving && 'grayscale',
        className,
      )}
      style={{ width: size, height: size, boxShadow: `0 0 0 2px ${isLiving ? ring : 'var(--ft-border)'}` }}
    >
      {photoUrl ? (
        <img src={photoUrl} alt={name} className="size-full object-cover" loading="lazy" />
      ) : (
        <svg viewBox="0 0 64 64" className="size-full" role="img" aria-label={name}>
          <title>{name}</title>
          <rect width="64" height="64" fill={gender === 'FEMALE' ? '#f3dfe6' : '#dde9f1'} />
          {gender === 'FEMALE' ? (
            <>
              <path d="M8 64c0-16 10-26 24-26s24 10 24 26z" fill="#1d1d24" />
              <path d="M16 36c0-14 7-24 16-24s16 10 16 24c0 6-7 10-16 10s-16-4-16-10z" fill="#1d1d24" />
              <ellipse cx="32" cy="32" rx="9" ry="11" fill="#c99a78" />
            </>
          ) : (
            <>
              <path d="M8 64c0-15 10-24 24-24s24 9 24 24z" fill="#f8f8f6" />
              <path d="M14 40c0-17 8-28 18-28s18 11 18 28l-6 6H20z" fill="#ffffff" stroke="#d9dde0" />
              <ellipse cx="32" cy="32" rx="9" ry="11" fill="#c99a78" />
              <path
                d="M19 22c4-4 9-6 13-6s9 2 13 6"
                fill="none"
                stroke="#1d1d24"
                strokeWidth="3"
                strokeLinecap="round"
              />
            </>
          )}
        </svg>
      )}
    </span>
  );
}
