
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { User, LogOut } from 'lucide-react';
import Logo from '@/components/common/Logo';
// import { Link } from 'react-router-dom'; // Link might not be needed directly for this item anymore
import { useNavigate } from 'react-router-dom';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';

interface DashboardHeaderProps {
  onSignOut: () => void;
  userInitial: string;
}

const DashboardHeader: React.FC<DashboardHeaderProps> = ({ onSignOut, userInitial }) => {
  const [isOpen, setIsOpen] = useState(false);
  const navigate = useNavigate();

  const handleProfileNavigation = () => {
    setIsOpen(false); // Close the dropdown
    navigate('/profile-settings');
  };

  return (
    <header className="border-b border-border">
      <div className="container mx-auto py-4 px-6">
        <div className="flex items-center justify-between">
          <Logo showBanner={true} size="lg" />

          <div className="flex items-center space-x-4">
            <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="relative p-1 h-10 w-10 rounded-full">
                  <div className="w-8 h-8 rounded-full bg-lavender flex items-center justify-center">
                    <span className="text-white font-medium text-sm">
                      {userInitial}
                    </span>
                  </div>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem
                  onSelect={handleProfileNavigation}
                  className="cursor-pointer"
                >
                  <User className="mr-2 h-4 w-4" />
                  <span>Profile</span>
                </DropdownMenuItem>
                {/* The non-functional "Settings" item below has been removed. */}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onSignOut} className="cursor-pointer">
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Sign Out</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </header>
  );
};

export default DashboardHeader;
