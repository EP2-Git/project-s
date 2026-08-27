
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabaseClient';

interface CreateMeetingTypeProps {
  userId?: string;
  onMeetingTypeCreated?: () => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onSuccess?: () => void;
}

const CreateMeetingType: React.FC<CreateMeetingTypeProps> = ({
  userId,
  onMeetingTypeCreated = () => {},
  open,
  onOpenChange,
  onSuccess
}) => {
  const [isCreating, setIsCreating] = useState(open !== undefined ? open : false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [durationMinutes, setDurationMinutes] = useState('30');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  // If using controlled open state
  React.useEffect(() => {
    if (open !== undefined) {
      setIsCreating(open);
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const normalizedTitle = title.trim();
    const normalizedDescription = description.trim();
    const duration = Number(durationMinutes);
    if (!normalizedTitle || normalizedTitle.length > 120) {
      setValidationError('Title must contain 1 to 120 characters.');
      return;
    }
    if (normalizedDescription.length > 2000) {
      setValidationError('Description cannot exceed 2,000 characters.');
      return;
    }
    if (!Number.isInteger(duration) || duration < 5 || duration > 1440) {
      setValidationError('Duration must be a whole number from 5 to 1,440 minutes.');
      return;
    }
    setValidationError(null);

    if (!userId) {
      toast.error('Please sign in again before creating a meeting type.');
      return;
    }

    setIsSubmitting(true);

    try {
      const { error } = await supabase
        .from('meeting_types')
        .insert([
          {
            title: normalizedTitle,
            description: normalizedDescription || null,
            duration_minutes: duration,
            user_id: userId
          }
        ]);

      if (error) throw error;

      toast.success('Meeting type created successfully');
      setTitle('');
      setDescription('');
      setDurationMinutes('30');

      // Handle controlled or uncontrolled closing
      if (onOpenChange) {
        onOpenChange(false);
      } else {
        setIsCreating(false);
      }

      // Call the appropriate callback
      if (onSuccess) {
        onSuccess();
      } else if (onMeetingTypeCreated) {
        onMeetingTypeCreated();
      }
    } catch {
      toast.error('Unable to create the meeting type. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (onOpenChange) {
      onOpenChange(false);
    } else {
      setIsCreating(false);
    }
  };

  // If open state is controlled externally and it's false, return nothing or a button
  if (open === false) {
    return null;
  }

  if (!isCreating && open === undefined) {
    return (
      <Button
        onClick={() => setIsCreating(true)}
        className="bg-lavender hover:bg-lavender-light mb-6 w-full"
      >
        <Plus className="h-4 w-4 mr-2" />
        Create New Meeting Type
      </Button>
    );
  }

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Create New Meeting Type</CardTitle>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">Title *</Label>
            <Input
              id="title"
              placeholder="Quick Chat, Discovery Call, etc."
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              placeholder="A brief description of this meeting type"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={2000}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="duration">Duration (minutes) *</Label>
            <Input
              id="duration"
              type="number"
              min="5"
              step="1"
              max="1440"
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(e.target.value)}
              required
            />
          </div>
          {validationError && (
            <p className="text-sm text-destructive" role="alert">{validationError}</p>
          )}
        </CardContent>

        <CardFooter className="flex justify-end space-x-2">
          <Button
            type="button"
            variant="outline"
            onClick={handleClose}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={isSubmitting}
            className="bg-lavender hover:bg-lavender-light"
          >
            {isSubmitting ? 'Creating...' : 'Create Meeting Type'}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
};

export default CreateMeetingType;
