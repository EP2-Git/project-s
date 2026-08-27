import React, { useMemo } from 'react';
import { Label } from '@/components/ui/label';
import { listSupportedTimeZones } from '@/lib/time';
import type { IanaTimeZone } from '@/types/publicBooking';

interface TimeZoneSelectProps {
  value: IanaTimeZone;
  onChange: (timeZone: IanaTimeZone) => void;
  id?: string;
}

const TimeZoneSelect: React.FC<TimeZoneSelectProps> = ({
  value,
  onChange,
  id = 'display-time-zone',
}) => {
  const zones = useMemo(listSupportedTimeZones, []);

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Times shown in</Label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value as IanaTimeZone)}
        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        {zones.map((zone) => (
          <option key={zone} value={zone}>
            {zone.split('_').join(' ')}
          </option>
        ))}
      </select>
    </div>
  );
};

export default TimeZoneSelect;
