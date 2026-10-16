// Public, fictional inputs shared by every transport. No database credentials.
export const fixture = Object.freeze({
  username: 'demo-host',
  timeZone: 'Etc/UTC',
  booker: Object.freeze({
    name: 'Casey Example',
    email: 'casey.example@example.invalid',
    notes: 'Synthetic local transport example; preparation is not permission.',
  }),
  lookAheadDays: 14,
});

// Keep these readable wire bindings explicit; tests compare them to the registry.
export const bindings = Object.freeze({
  getBookingPage: {
    id: 'project-s.public.get_booking_page.v1', method: 'GET',
    path: '/api/v1/public/booking-pages/{username}', tool: 'project_s_get_booking_page_v1',
  },
  listFreeSlots: {
    id: 'project-s.public.list_free_slots.v1', method: 'POST',
    path: '/api/v1/public/free-slots/search', tool: 'project_s_list_free_slots_v1',
  },
  prepareBooking: {
    id: 'project-s.public.prepare_booking.v1', method: 'POST',
    path: '/api/v1/public/bookings/prepare', tool: 'project_s_prepare_booking_v1',
  },
  createBooking: {
    id: 'project-s.public.create_booking.v1', method: 'POST',
    path: '/api/v1/public/bookings', tool: 'project_s_create_booking_v1',
  },
});

export const expectedRefusal = Object.freeze({
  code: 'CONFIRMATION_REQUIRED', status: 428, retryAction: 'confirm_in_browser',
});
