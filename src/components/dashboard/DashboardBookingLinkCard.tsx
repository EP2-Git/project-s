import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Copy, Share2, Settings, Check, ExternalLink, MinusCircle, PlusCircle, Code2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';

interface DashboardBookingLinkCardProps {
  username: string | null;
  profile?: {
    created_at: string | null;
  } | null;
}

const getBookingUrl = (username: string) => `${window.location.origin}/book/${username}`;

// Function to check if a user account was created within the last hour
const isNewUser = (createdAt: string | null): boolean => {
  if (!createdAt) return false;

  const creationTime = new Date(createdAt).getTime();
  const oneHourAgo = Date.now() - 60 * 60 * 1000; // 1 hour in milliseconds

  return creationTime > oneHourAgo;
};

const DashboardBookingLinkCard: React.FC<DashboardBookingLinkCardProps> = ({
  username,
  profile
}) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [copied, setCopied] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Get user's creation time from auth metadata if available
  const userCreatedAt = user?.created_at || profile?.created_at || null;

  // Only show setup banner if:
  // 1. User has no username, OR
  // 2. Account was created recently (within the last hour)
  const shouldShowSetupBanner = !username || isNewUser(userCreatedAt);

  // If no username or new user, show the setup banner
  if (shouldShowSetupBanner) {
    return (
      <div className="w-full max-w-xl mx-auto bg-card border border-border rounded-lg p-4 flex flex-col items-center gap-3 shadow-sm">
        <div className="flex-1 text-center">
          <div className="text-sm text-muted-foreground mb-3">
            {!username ?
              "Set up your username in profile settings to activate your booking link" :
              "Your booking link is ready to use! Share it with others so they can book time with you."
            }
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link to="/profile-settings">
              <Settings className="h-4 w-4 mr-2" />
              Profile Settings
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  const bookingUrl = getBookingUrl(username!);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(bookingUrl);
    setCopied(true);
    toast({ title: 'Link copied!', description: 'Your public booking link is now on your clipboard.' });
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Book time with me', url: bookingUrl });
      } catch {
        return;
      }
    } else {
      handleCopy();
    }
  };

  const toggleCollapse = () => {
    setIsCollapsed(!isCollapsed);
  };

  const openBookingLink = () => {
    window.open(bookingUrl, '_blank', 'noopener,noreferrer');
  };

  if (isCollapsed) {
    return (
      <div className="w-full max-w-xl mx-auto bg-card border border-border rounded-lg p-3 flex justify-between items-center shadow-sm">
        <span className="text-sm font-medium">Booking Link</span>
        <Button size="sm" variant="ghost" onClick={toggleCollapse} className="h-8 w-8 p-0">
          <PlusCircle className="h-4 w-4 text-muted-foreground" />
          <span className="sr-only">Expand</span>
        </Button>
      </div>
    );
  }

  return (
    <div className="w-full max-w-xl mx-auto bg-card border border-border rounded-lg p-4 flex flex-col sm:flex-row items-center gap-3 shadow-sm">
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1">
          <div className="text-xs font-medium text-muted-foreground">Your booking link</div>
          <Button size="sm" variant="ghost" onClick={toggleCollapse} className="h-6 w-6 p-0">
            <MinusCircle className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="sr-only">Collapse</span>
          </Button>
        </div>
        <a
          href={bookingUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            "block truncate font-medium text-sm px-3 py-2 rounded",
            "bg-muted hover:bg-muted/80 transition-colors cursor-pointer select-all",
            "border border-border/60 text-foreground"
          )}
          onClick={(e) => {
            e.preventDefault();
            openBookingLink();
          }}
        >
          {bookingUrl}
        </a>
      </div>
      <div className="flex gap-2 mt-2 sm:mt-0">
        <Button
          size="icon"
          variant="outline"
          aria-label="Copy link"
          onClick={handleCopy}
          className={cn(
            "h-8 w-8 transition-all duration-200",
            copied && "border-green-500/50 text-green-500"
          )}
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        </Button>
        <Button size="icon" variant="outline" aria-label="Share link" onClick={handleShare} className="h-8 w-8">
          <Share2 className="h-4 w-4" />
        </Button>
        <Popover>
          <PopoverTrigger asChild>
            <Button size="icon" variant="outline" aria-label="Embed code" className="h-8 w-8">
              <Code2 className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-96" align="end">
            <EmbedSnippet username={username!} />
          </PopoverContent>
        </Popover>
        <Button size="icon" variant="outline" aria-label="Open link" onClick={openBookingLink} className="h-8 w-8">
          <ExternalLink className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
};

const EmbedSnippet: React.FC<{ username: string }> = ({ username }) => {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const embedUrl = `${window.location.origin}/embed/${username}`;
  const snippet = `<iframe src="${embedUrl}" title="Book a meeting with ${username}" width="100%" height="780" style="border:0;border-radius:12px;" loading="lazy"></iframe>`;

  const copy = async () => {
    await navigator.clipboard.writeText(snippet);
    setCopied(true);
    toast({ title: 'Embed code copied!', description: 'Paste it into your website HTML.' });
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-3">
      <div>
        <h4 className="font-medium text-sm">Embed on your website</h4>
        <p className="text-xs text-muted-foreground mt-1">
          Copy this snippet into your HTML where you want the booking page to appear.
        </p>
      </div>
      <Textarea readOnly value={snippet} className="font-mono text-xs h-28 resize-none" onFocus={(e) => e.currentTarget.select()} />
      <div className="flex gap-2">
        <Button size="sm" onClick={copy} className="flex-1">
          {copied ? <Check className="h-4 w-4 mr-2" /> : <Copy className="h-4 w-4 mr-2" />}
          {copied ? 'Copied' : 'Copy snippet'}
        </Button>
        <Button size="sm" variant="outline" asChild>
          <a href={embedUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="h-4 w-4 mr-2" />
            Preview
          </a>
        </Button>
      </div>
    </div>
  );
};

export default DashboardBookingLinkCard;
