
import React from 'react';
import Logo from '@/components/common/Logo';
import { ArrowRight } from 'lucide-react';

const getHomeUrl = () => {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin + '/';
  }
  return '/';
};

const BookingHeader: React.FC = () => {
  const homeUrl = getHomeUrl();
  return (
    <div className="border-b border-border bg-gradient-to-r from-background via-background/98 to-background/95 shadow-sm">
      <div className="container mx-auto py-4 px-6 flex items-center justify-between">
        <Logo size="lg" showBanner={true} />
        <a
          href={homeUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-muted-foreground hover:text-primary transition-colors flex items-center gap-1.5 group font-medium"
        >
          Learn more <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-0.5 transition-transform" />
        </a>
      </div>
    </div>
  );
};

export default BookingHeader;
