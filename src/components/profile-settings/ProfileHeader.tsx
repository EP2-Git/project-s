
import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';

interface ProfileHeaderProps {
  title: string;
  backLink: string;
}

const ProfileHeader: React.FC<ProfileHeaderProps> = ({ title, backLink }) => {
  const navigate = useNavigate();

  return (
    <div className="flex items-center gap-2 mb-6">
      <Button variant="ghost" size="icon" onClick={() => navigate(backLink)}>
        <ArrowLeft className="h-5 w-5" />
      </Button>
      <h1 className="text-3xl font-bold">{title}</h1>
    </div>
  );
};

export default ProfileHeader;
