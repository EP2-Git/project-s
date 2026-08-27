
import React from "react";
import { cn } from "@/lib/utils";

interface ContainerProps {
  children: React.ReactNode;
  className?: string;
  noPadding?: boolean;
}

const Container: React.FC<ContainerProps> = ({
  children,
  className,
  noPadding = false
}) => {
  return (
    <div className={cn(
      "container mx-auto",
      !noPadding && "px-4 sm:px-6 md:px-8",
      className
    )}>
      {children}
    </div>
  );
};

export default Container;
