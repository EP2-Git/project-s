import React from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  showBanner?: boolean;
}

const sizeClasses = {
  sm: { icon: 'h-6 w-6', text: 'text-base' },
  md: { icon: 'h-8 w-8', text: 'text-xl' },
  lg: { icon: 'h-10 w-10', text: 'text-2xl' },
};

const Logo: React.FC<LogoProps> = ({
  size = 'md',
  className,
  showBanner = true,
}) => (
  <Link
    to="/"
    aria-label="Project S home"
    className={cn('inline-flex items-center gap-2', className)}
  >
    <img src="/favicon.svg" alt="" className={sizeClasses[size].icon} />
    {showBanner && (
      <span className={cn('font-bold tracking-tight', sizeClasses[size].text)}>
        Project S
      </span>
    )}
  </Link>
);

export default Logo;
