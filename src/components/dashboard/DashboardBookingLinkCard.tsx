import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Copy, Share2, Check, ExternalLink, MinusCircle, PlusCircle, Code2, Circle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';
import { useBookingSetup } from '@/hooks/useBookingSetup';

interface DashboardBookingLinkCardProps {
  userId: string | undefined;
  onNavigate: (tab: 'meeting-types' | 'availability') => void;
}

const DashboardBookingLinkCard: React.FC<DashboardBookingLinkCardProps> = ({ userId, onNavigate }) => {
  const { toast } = useToast();
  const setup = useBookingSetup(userId);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const completed = [setup.profileComplete, setup.meetingTypeComplete, setup.availabilityComplete].filter(Boolean).length;
  const username = setup.status === 'loaded' ? setup.username : null;
  const bookingUrl = username ? `${window.location.origin}/book/${encodeURIComponent(username)}` : null;

  const handleCopy = async () => {
    if (!bookingUrl) return;
    try {
      await navigator.clipboard.writeText(bookingUrl);
      setCopyError(false);
      setCopied(true);
      toast({ title: 'Link copied!', description: 'Your public booking link is now on your clipboard.' });
    } catch {
      setCopied(false);
      setCopyError(true);
    }
  };

  const handleShare = async () => {
    if (!bookingUrl) return;
    if (!navigator.share) {
      await handleCopy();
      return;
    }
    try {
      await navigator.share({ title: 'Book time with me', url: bookingUrl });
    } catch (error) {
      const cancelled = (error instanceof Error || error instanceof DOMException) && error.name === 'AbortError';
      if (!cancelled) await handleCopy();
    }
  };

  const steps = [
    { label: 'Profile and timezone', complete: setup.profileComplete, tab: null },
    { label: 'Meeting types', complete: setup.meetingTypeComplete, tab: 'meeting-types' as const },
    { label: 'Availability', complete: setup.availabilityComplete, tab: 'availability' as const },
  ];

  return (
    <section aria-label="Booking setup" className="w-full max-w-xl mx-auto bg-card border border-border rounded-lg p-4 shadow-xs">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium">
          {isCollapsed ? 'Booking setup' : setup.status === 'loaded' && completed === 3
            ? 'Your setup is saved' : 'Finish your booking setup'}
        </h2>
        <Button size="sm" variant="ghost" onClick={() => setIsCollapsed(!isCollapsed)} aria-expanded={!isCollapsed} aria-controls="booking-setup-details" className="h-8 w-8 p-0 shrink-0">
          {isCollapsed ? <PlusCircle className="h-4 w-4" /> : <MinusCircle className="h-4 w-4" />}
          <span className="sr-only">{isCollapsed ? 'Expand' : 'Collapse'} booking setup</span>
        </Button>
      </div>
      <div id="booking-setup-details" hidden={isCollapsed} className="space-y-4 mt-3">
        {setup.status === 'loading' && <p role="status" className="text-sm text-muted-foreground">Checking saved setup…</p>}
        {setup.status === 'error' && <p role="alert" className="text-sm text-muted-foreground">Could not check your saved setup. Check your connection and sign in again if your session expired, then retry.</p>}
        {setup.status === 'loaded' && (
          <>
            <p className="text-sm text-muted-foreground" role="status">
              {completed} of 3 setup steps saved. {completed === 3
                ? 'Preview your booking page to check guest times. Availability is checked again when a guest books.'
                : 'Complete these steps to offer meetings. Your changes must be saved before they appear here.'}
            </p>
            <ol className="space-y-2">
              {steps.map(({ label, complete, tab }) => (
                <li key={label} className="flex items-center gap-2 text-sm">
                  {complete ? <Check aria-hidden="true" className="h-4 w-4 shrink-0" /> : <Circle aria-hidden="true" className="h-4 w-4 shrink-0" />}
                  {tab ? <Button variant="link" className="h-auto p-0 text-sm text-left whitespace-normal text-foreground" onClick={() => onNavigate(tab)}>{label}</Button>
                    : <Link className="underline underline-offset-4" to="/profile-settings">{label}</Link>}
                  <span className="ml-auto text-xs text-muted-foreground shrink-0">{complete ? 'Saved' : 'Needs setup'}</span>
                </li>
              ))}
            </ol>
          </>
        )}
        <Button size="sm" variant="outline" disabled={setup.status === 'loading'} onClick={setup.refresh}>Check setup again</Button>
        {bookingUrl && username && (
          <div className="space-y-2 border-t border-border pt-3">
            <p className="text-xs font-medium text-muted-foreground">Your booking link</p>
            <a href={bookingUrl} target="_blank" rel="noopener noreferrer" className="block break-all font-medium text-sm px-3 py-2 rounded bg-muted hover:bg-muted/80 border border-border/60 select-all">{bookingUrl}</a>
            <div className="flex flex-wrap gap-2">
              <Button size="icon" variant="outline" aria-label="Copy link" onClick={handleCopy} className={cn('h-8 w-8', copied && 'border-green-500/50 text-green-500')}>
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
              <Button size="icon" variant="outline" aria-label="Share link" onClick={handleShare} className="h-8 w-8"><Share2 className="h-4 w-4" /></Button>
              <Popover>
                <PopoverTrigger asChild><Button size="icon" variant="outline" aria-label="Embed code" className="h-8 w-8"><Code2 className="h-4 w-4" /></Button></PopoverTrigger>
                <PopoverContent aria-label="Booking embed" className="w-96 max-w-[calc(100vw-2rem)]" align="end"><EmbedSnippet username={username} /></PopoverContent>
              </Popover>
              <Button size="icon" variant="outline" aria-label="Open link" asChild className="h-8 w-8"><a href={bookingUrl} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-4 w-4" /></a></Button>
            </div>
            {copyError && <p role="alert" className="text-sm">Could not copy automatically. Select and copy the link above.</p>}
          </div>
        )}
      </div>
    </section>
  );
};

const EmbedSnippet: React.FC<{ username: string }> = ({ username }) => {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const embedUrl = `${window.location.origin}/embed/${encodeURIComponent(username)}`;
  const snippet = `<iframe src="${embedUrl}" title="Book a meeting" width="100%" height="780" style="border:0;border-radius:12px;" loading="lazy"></iframe>`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      setFailed(false);
      setCopied(true);
      toast({ title: 'Embed code copied!', description: 'Paste it into your website HTML.' });
    } catch {
      setFailed(true);
    }
  };

  return (
    <div className="space-y-3">
      <div><h3 className="font-medium text-sm">Embed on your website</h3><p className="text-xs text-muted-foreground mt-1">Copy this snippet into your HTML where you want the booking page to appear.</p></div>
      <Textarea aria-label="Booking embed code" readOnly value={snippet} className="font-mono text-xs h-28 resize-none" onFocus={(e) => e.currentTarget.select()} />
      {failed && <p role="alert" className="text-sm">Could not copy automatically. Select and copy the code above.</p>}
      <div className="flex gap-2">
        <Button size="sm" onClick={copy} className="flex-1">{copied ? <Check className="h-4 w-4 mr-2" /> : <Copy className="h-4 w-4 mr-2" />}{copied ? 'Copied' : 'Copy snippet'}</Button>
        <Button size="sm" variant="outline" asChild><a href={embedUrl} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-4 w-4 mr-2" />Preview</a></Button>
      </div>
    </div>
  );
};

export default DashboardBookingLinkCard;
