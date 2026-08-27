
import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import WeeklyAvailability from './WeeklyAvailability';
import SpecificDateAvailability from './SpecificDateAvailability';
import type { IanaTimeZone } from '@/types/publicBooking';

interface AvailabilitySettingsProps {
  userId: string;
  hostTimeZone: IanaTimeZone;
}

const AvailabilitySettings: React.FC<AvailabilitySettingsProps> = ({ userId, hostTimeZone }) => {
  const [activeTab, setActiveTab] = useState('weekly');

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Manage Availability</CardTitle>
        <p className="text-sm text-muted-foreground">Weekly hours and specific dates use {hostTimeZone}.</p>
      </CardHeader>
      <CardContent>
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="mb-4">
            <TabsTrigger value="weekly">Weekly Schedule</TabsTrigger>
            <TabsTrigger value="specific">Specific Dates</TabsTrigger>
          </TabsList>
          <TabsContent value="weekly">
            <WeeklyAvailability userId={userId} />
          </TabsContent>
          <TabsContent value="specific">
            <SpecificDateAvailability userId={userId} hostTimeZone={hostTimeZone} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
};

export default AvailabilitySettings;
