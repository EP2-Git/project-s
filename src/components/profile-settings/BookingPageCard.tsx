
import React, { useState } from 'react';
import { Copy, Check, LinkIcon, ExternalLink } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { TooltipProvider, Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from 'sonner';

interface BookingPageCardProps {
  profileUrl: string;
  username: string;
}

const BookingPageCard: React.FC<BookingPageCardProps> = ({ profileUrl, username }) => {
  const [copied, setCopied] = useState(false);

  const copyProfileLink = () => {
    if (!username) return;

    navigator.clipboard.writeText(profileUrl);
    setCopied(true);

    setTimeout(() => {
      setCopied(false);
    }, 2000);

    toast.success('Booking link copied to clipboard');
  };

  const viewProfilePage = () => {
    if (!username) return;
    window.open(profileUrl, '_blank');
  };

  if (!username) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your Booking Page</CardTitle>
        <CardDescription>
          Share this link with others so they can book meetings with you
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col space-y-4">
          <div className="flex items-center p-3 border rounded-md bg-muted/30">
            <div className="flex items-center flex-1 overflow-hidden">
              <LinkIcon className="h-4 w-4 mr-2 text-muted-foreground flex-shrink-0" />
              <span className="text-sm truncate">{profileUrl}</span>
            </div>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={copyProfileLink}
                    className="ml-2"
                  >
                    {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{copied ? 'Copied!' : 'Copy link'}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <Button variant="outline" onClick={viewProfilePage} className="flex items-center">
            <ExternalLink className="h-4 w-4 mr-2" />
            View My Booking Page
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default BookingPageCard;
