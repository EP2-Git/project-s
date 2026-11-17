
import React, { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/lib/supabaseClient';
import { toast } from 'sonner';
import Logo from '@/components/common/Logo';
import { authRoute, getAuthReturnTo } from '@/lib/auth';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo = getAuthReturnTo(location.search);

  // Set dark mode as default
  useEffect(() => {
    document.documentElement.classList.add('dark');
  }, []);

  // Check if user is already logged in
  useEffect(() => {
    let active = true;
    const checkUser = async () => {
      const { data } = await supabase.auth.getSession();
      if (active && data.session) {
        navigate(returnTo, { replace: true });
      }
    };

    checkUser();
    return () => { active = false; };
  }, [navigate, returnTo]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        // Check if it's an email verification error
        if (error.message.includes('Email not confirmed')) {
          toast.error('Please verify your email address before logging in');
          navigate(authRoute('/email-verification', returnTo), { state: { email: email.trim().toLowerCase() } });
          return;
        }
        throw error;
      }

      toast.success('Logged in successfully');
      navigate(returnTo, { replace: true });
    } catch {
      toast.error('Unable to sign in. Check your credentials and try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6">
      <Logo className="mb-8" showBanner={false} />

      <Card className="w-full max-w-md animate-scale-in">
        <CardHeader>
          <CardTitle className="text-2xl">Welcome back</CardTitle>
          <CardDescription>
            Sign in to your Project S account
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleLogin}>
          <CardContent className="space-y-4">
            <div className="form-field-stack">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.invalid"
                autoComplete="email"
                maxLength={320}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="form-field-stack">
              <div>
                <Label htmlFor="password">Password</Label>
              </div>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
          </CardContent>
          <CardFooter className="flex flex-col space-y-4">
            <Button
              className="w-full bg-lavender hover:bg-lavender-light"
              type="submit"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Logging in...' : 'Log in'}
            </Button>
            <div className="text-center">
              <span className="text-foreground/70 text-sm">
                Don't have an account?{' '}
                <Link to={authRoute('/signup', returnTo)} className="text-indigo-300 hover:underline">
                  Sign up
                </Link>
              </span>
            </div>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
};

export default Login;
