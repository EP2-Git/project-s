
import React, { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabaseClient';
import Logo from '@/components/common/Logo';
import SignupForm from '@/components/auth/SignupForm';
import { getAuthReturnTo } from '@/lib/auth';

const Signup = () => {
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

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6">
      <Logo className="mb-8" showBanner={false} />
      <SignupForm />
    </div>
  );
};

export default Signup;
