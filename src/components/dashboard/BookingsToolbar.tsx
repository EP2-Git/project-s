
import React from 'react';
import { Button } from '@/components/ui/button';
import { RefreshCw, Filter, ChevronDown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

interface BookingsToolbarProps {
  filter: 'all' | 'upcoming' | 'week';
  setFilter: (filter: 'all' | 'upcoming' | 'week') => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  isRateLimited?: boolean;
}

const BookingsToolbar: React.FC<BookingsToolbarProps> = ({
  filter,
  setFilter,
  onRefresh,
  isRefreshing,
  isRateLimited = false,
}) => {
  // Get human-readable filter name
  const getFilterName = () => {
    switch (filter) {
      case 'upcoming':
        return 'Upcoming';
      case 'week':
        return 'This Week';
      case 'all':
      default:
        return 'All Bookings';
    }
  };

  const handleRefresh = () => {
    if (!isRateLimited && !isRefreshing) {
      onRefresh();
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="flex items-center gap-1">
              <Filter className="h-3.5 w-3.5" />
              {getFilterName()}
              <ChevronDown className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onClick={() => setFilter('all')} className={cn(filter === 'all' && "bg-muted")}>All Bookings</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setFilter('upcoming')} className={cn(filter === 'upcoming' && "bg-muted")}>Upcoming</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setFilter('week')} className={cn(filter === 'week' && "bg-muted")}>This Week</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex items-center space-x-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleRefresh}
          disabled={isRefreshing || isRateLimited}
          className={cn(
            "text-muted-foreground hover:text-foreground transition-colors",
            (isRefreshing || isRateLimited) && "opacity-50 cursor-not-allowed"
          )}
          title={isRateLimited ? "Rate limited. Please wait a moment before refreshing again." : "Refresh bookings"}
        >
          <RefreshCw
            className={cn(
              "h-3.5 w-3.5 mr-1",
              isRefreshing ? "animate-spin text-primary" : ""
            )}
          />
          {isRateLimited ? "Rate Limited" : "Refresh"}
        </Button>
      </div>
    </div>
  );
};

export default BookingsToolbar;
