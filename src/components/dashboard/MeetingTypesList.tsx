
import React, { useState } from 'react';
import { Trash, Plus, Calendar, ToggleRight, ToggleLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { MeetingType } from '@/types/booking';
import CreateMeetingType from '@/components/CreateMeetingType';

interface MeetingTypesListProps {
  meetingTypes: MeetingType[];
  loading: boolean;
  userId?: string; // Add explicit userId prop
  onToggleActive: (meetingTypeId: string, currentStatus: boolean) => void;
  onDelete: (meetingTypeId: string) => void;
  onMeetingTypeCreated?: () => void; // Make this prop optional
}

const MeetingTypesList: React.FC<MeetingTypesListProps> = ({
  meetingTypes,
  loading,
  userId, // Use explicit userId prop
  onToggleActive,
  onDelete,
  onMeetingTypeCreated = () => {} // Provide a default empty function
}) => {
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  if (loading) {
    return (
      <div className="flex flex-col justify-center items-center py-12 border border-border rounded-md bg-card/50">
        <Loader2 className="h-10 w-10 animate-spin text-primary mb-4" />
        <span className="text-muted-foreground">Loading your meeting types...</span>
      </div>
    );
  }

  if (!Array.isArray(meetingTypes) || meetingTypes.length === 0) {
    return (
      <div className="text-center py-12 border border-border rounded-md bg-card/50">
        <Calendar className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
        <h3 className="text-lg font-medium mb-2">No meeting types found</h3>
        <p className="text-sm text-muted-foreground max-w-md mx-auto mb-6">
          Create your first meeting type so people can book time with you
        </p>
        <Button onClick={() => setIsCreateModalOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Create a Meeting Type
        </Button>

        <CreateMeetingType
          userId={userId} // Use the explicit userId prop instead of trying to get it from meetingTypes[0]
          onMeetingTypeCreated={onMeetingTypeCreated}
          open={isCreateModalOpen}
          onOpenChange={setIsCreateModalOpen}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-medium">Your Meeting Types</h3>
        <Button onClick={() => setIsCreateModalOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Create New
        </Button>
      </div>

      <div className="grid gap-4">
        {meetingTypes.map((meetingType) => (
          <Card key={meetingType.id} className="p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center">
            <div className="mb-3 sm:mb-0">
              <div className="flex items-center gap-2">
                <h4 className="font-medium">{meetingType.title}</h4>
                <div className="flex items-center">
                  {meetingType.active ? (
                    <span className="text-xs px-2 py-0.5 bg-green-500/10 text-green-500 rounded-full">Active</span>
                  ) : (
                    <span className="text-xs px-2 py-0.5 bg-gray-500/10 text-gray-500 rounded-full">Inactive</span>
                  )}
                </div>
              </div>
              <p className="text-sm text-muted-foreground mt-1">{meetingType.duration_minutes} minutes</p>
            </div>
            <div className="flex items-center space-x-2 w-full sm:w-auto justify-end">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onToggleActive(meetingType.id, meetingType.active || false)}
                title={meetingType.active ? "Deactivate" : "Activate"}
              >
                {meetingType.active ? (
                  <ToggleRight className="h-4 w-4 text-green-500" />
                ) : (
                  <ToggleLeft className="h-4 w-4 text-muted-foreground" />
                )}
              </Button>
              <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive/90" onClick={() => onDelete(meetingType.id)}>
                <Trash className="h-4 w-4" />
              </Button>
            </div>
          </Card>
        ))}
      </div>

      <CreateMeetingType
        userId={userId || (meetingTypes.length > 0 ? meetingTypes[0]?.user_id : undefined)}
        onMeetingTypeCreated={onMeetingTypeCreated}
        open={isCreateModalOpen}
        onOpenChange={setIsCreateModalOpen}
      />
    </div>
  );
};

export default MeetingTypesList;
