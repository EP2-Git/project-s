import { useEffect, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabaseClient';
import { signOut as signOutService } from '@/services/profileService';

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    let active = true;

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (event, nextSession) => {
        if (!active) return;
        const nextUser = nextSession?.user ?? null;
        setSession(nextSession);
        setUser(nextUser);

        if (event === 'SIGNED_OUT') {
          navigate('/login');
        } else if (
          event === 'SIGNED_IN' &&
          nextUser &&
          (window.location.pathname === '/login' || window.location.pathname === '/signup')
        ) {
          navigate('/dashboard');
        }
      },
    );

    const loadSession = async () => {
      const { data, error } = await supabase.auth.getSession();
      if (!active) return;

      if (error) {
        setSession(null);
        setUser(null);
      } else {
        setSession(data.session);
        setUser(data.session?.user ?? null);
      }
      setLoading(false);
    };

    void loadSession();

    return () => {
      active = false;
      authListener.subscription.unsubscribe();
    };
  }, [navigate]);

  const handleSignOut = async () => {
    try {
      const success = await signOutService();
      if (success) {
        toast.success('Successfully signed out');
      } else {
        toast.error('Failed to sign out');
      }
    } catch {
      toast.error('An error occurred during sign out');
    }
  };

  return { user, session, loading, handleSignOut };
}
