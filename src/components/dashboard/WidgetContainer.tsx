import React, { useState } from 'react';
import { cn } from '@/lib/utils';
import { ChevronUp, ChevronDown } from 'lucide-react';

interface WidgetContainerProps {
  title?: string;
  description?: string;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  className?: string;
  headerClassName?: string;
  bodyClassName?: string;
  headerRightContent?: React.ReactNode;
  children: React.ReactNode;
}

const WidgetContainer: React.FC<WidgetContainerProps> = ({
  title,
  description,
  collapsible = false,
  defaultCollapsed = false,
  className = '',
  headerClassName = '',
  bodyClassName = '',
  headerRightContent,
  children,
}) => {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);

  const toggleCollapse = () => {
    if (collapsible) {
      setIsCollapsed(prev => !prev);
    }
  };

  return (
    <div
      className={cn(
        "bg-card border border-border rounded-lg shadow-sm transition-all duration-200",
        className
      )}
    >
      {(title || collapsible) && (
        <div
          className={cn(
            "flex items-center justify-between px-4 py-3 border-b border-border",
            collapsible && "cursor-pointer",
            headerClassName
          )}
          onClick={toggleCollapse}
        >
          <div>
            {title && <h3 className="text-base font-medium">{title}</h3>}
            {description && <p className="text-sm text-muted-foreground">{description}</p>}
          </div>
          <div className="flex items-center gap-2">
            {headerRightContent}
            {collapsible && (
              <button
                className="text-muted-foreground hover:text-foreground transition-colors"
                aria-label={isCollapsed ? "Expand" : "Collapse"}
              >
                {isCollapsed ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
              </button>
            )}
          </div>
        </div>
      )}

      <div
        className={cn(
          "transition-all duration-200 overflow-hidden",
          isCollapsed ? "max-h-0 opacity-0 p-0" : "max-h-[2000px] opacity-100 p-4",
          bodyClassName
        )}
      >
        {children}
      </div>
    </div>
  );
};

export default WidgetContainer;