
import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Mail } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabaseClient';
import Logo from '@/components/common/Logo';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const EmailVerification = () => {
  const [isResending, setIsResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const location = useLocation();
  const [email, setEmail] = useState(
    typeof location.state?.email === 'string' ? location.state.email : '',
  );

  useEffect(() => {
    let interval: number | null = null;

    if (cooldown > 0) {
      interval = window.setInterval(() => {
        setCooldown((prev) => Math.max(0, prev - 1));
      }, 1000);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [cooldown]);

  const handleResendEmail = async () => {
    if (!email) {
      toast.error('Enter the email address for the account first.');
      return;
    }

    try {
      setIsResending(true);
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: email.trim().toLowerCase(),
        options: {
          emailRedirectTo: window.location.origin + '/dashboard',
        }
      });

      if (error) {
        toast.error("Failed to resend verification email. Please try again.");
      } else {
        toast.success('A new verification email was requested.');
        setCooldown(30); // 30 second cooldown
      }
    } catch {
      toast.error("An unexpected error occurred. Please try again.");
    } finally {
      setIsResending(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6">
      <Logo className="mb-8" size="lg" />

      <Card className="w-full max-w-md animate-scale-in">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-lavender/10 flex items-center justify-center">
            <Mail className="h-6 w-6 text-lavender" />
          </div>
          <CardTitle className="text-2xl">Email verification</CardTitle>
          <CardDescription className="text-base mt-2">
            {email
              ? <>Your deployment requires verification for <span className="font-medium">{email}</span>.</>
              : 'Enter your account email to request another verification message.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="text-center space-y-4 py-2">
          <p className="text-muted-foreground">
            Use the verification link from your authentication provider before signing in.
          </p>
          <p className="text-sm text-muted-foreground">
            Delivery depends on the email provider configured by this deployment.
          </p>
          <div className="space-y-2 text-left">
            <Label htmlFor="verification-email">Account email</Label>
            <Input
              id="verification-email"
              type="email"
              autoComplete="email"
              maxLength={320}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>
        </CardContent>
        <CardFooter className="flex flex-col space-y-4">
          <Button
            className="w-full bg-lavender hover:bg-lavender/90"
            type="button"
            onClick={handleResendEmail}
            disabled={isResending || cooldown > 0 || !email.trim()}
          >
            {cooldown > 0
              ? `Resend email (${cooldown}s)`
              : isResending
                ? "Sending..."
                : "Resend verification email"}
          </Button>
          <Link to="/login" className="w-full">
            <Button
              className="w-full"
              variant="outline"
              type="button"
            >
              Return to login
            </Button>
          </Link>
          <p className="text-sm text-center text-muted-foreground pt-2">
            Need help?{' '}
            <Link to="/signup" className="text-lavender hover:underline">
              Try signing up again
            </Link>
          </p>
        </CardFooter>
      </Card>
    </div>
  );
};

export default EmailVerification;
