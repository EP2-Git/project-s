export const MCP_PROTOCOL_VERSION = '2026-07-28';

export const PROJECT_S_MCP_SERVER_INFO = Object.freeze({
  name: 'project-s-mcp',
  version: '0.1.0-prealpha',
});

export const PROJECT_S_MCP_TOOL_NAMES = Object.freeze([
  'project_s_get_booking_page_v1',
  'project_s_list_free_slots_v1',
  'project_s_prepare_booking_v1',
  'project_s_create_booking_v1',
]);

export const PROJECT_S_MCP_INSTRUCTIONS =
  'Discover a public booking page, list free slots, prepare a booking, and create it only after the human confirmation flow has approved the preparation. Preparing does not hold a slot.';
