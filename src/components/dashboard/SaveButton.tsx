
import React from 'react';
import { Button } from '@/components/ui/button';
import { useAvailabilityContext } from '@/contexts/AvailabilityContext';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface SaveButtonProps {
  userId: string;
}

const SaveButton: React.FC<SaveButtonProps> = ({ userId }) => {
  const { loading: isSaving, saveChanges, unsavedChanges } = useAvailabilityContext();

  const handleSave = async () => {
    if (!userId) {
      toast.error("Cannot save: No user ID provided");
      return;
    }

    if (unsavedChanges === false) {
      toast.info("No changes to save");
      return;
    }

    try {
      await saveChanges();
    } catch {
      toast.error("Failed to save availability");
    }
  };

  return (
    <Button
      onClick={handleSave}
      disabled={isSaving}
      className="min-w-[120px] relative"
    >
      {isSaving ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Saving...
        </>
      ) : (
        'Save Weekly Availability'
      )}
    </Button>
  );
};

export default SaveButton;
