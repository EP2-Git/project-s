
import React from 'react';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';

interface SubmitButtonProps {
  isLoading: boolean;
  isDisabled: boolean;
}

const SubmitButton: React.FC<SubmitButtonProps> = ({ isLoading, isDisabled }) => {
  return (
    <Button
      type="submit"
      className="w-full bg-lavender hover:bg-lavender/90"
      disabled={isDisabled}
    >
      {isLoading ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Creating account...
        </>
      ) : (
        'Create Account'
      )}
    </Button>
  );
};

export default SubmitButton;
