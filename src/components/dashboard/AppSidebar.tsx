import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Calendar, Clock, LayoutDashboard, Link2, LogOut, Settings } from 'lucide-react';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';
import Logo from '@/components/common/Logo';

interface AppSidebarProps {
  onSignOut: () => void;
  username: string | null;
  userInitial: string;
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

const navItems = [
  { key: 'overview', label: 'Overview', icon: LayoutDashboard },
  { key: 'bookings', label: 'Bookings', icon: Calendar },
  { key: 'meeting-types', label: 'Meeting types', icon: Clock },
  { key: 'availability', label: 'Availability', icon: Link2 },
];

export const AppSidebar: React.FC<AppSidebarProps> = ({
  onSignOut,
  username,
  userInitial,
  activeTab,
  setActiveTab,
}) => {
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';
  const navigate = useNavigate();

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarHeader className="border-b border-sidebar-border px-3 py-4">
        {!collapsed ? (
          <Logo size="md" showBanner={false} />
        ) : (
          <div className="w-8 h-8 rounded-md bg-primary flex items-center justify-center mx-auto">
            <span className="text-primary-foreground font-bold text-sm">S</span>
          </div>
        )}
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.key}>
                  <SidebarMenuButton
                    isActive={activeTab === item.key}
                    onClick={() => setActiveTab(item.key)}
                    tooltip={item.label}
                  >
                    <item.icon className="h-4 w-4" />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Account</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  onClick={() => navigate('/profile-settings')}
                  tooltip="Profile settings"
                >
                  <Settings className="h-4 w-4" />
                  <span>Settings</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center shrink-0">
            <span className="text-primary-foreground font-medium text-sm">{userInitial}</span>
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{username || 'Account'}</p>
              <button
                onClick={onSignOut}
                className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
              >
                <LogOut className="h-3 w-3" /> Sign out
              </button>
            </div>
          )}
        </div>
      </SidebarFooter>
    </Sidebar>
  );
};

export default AppSidebar;
