export type MerlinSystemConnectorMode = 'browser_session' | 'internal_service';
export type MerlinSystemConnectorActionClass = 'read' | 'stage' | 'execute';

export type MerlinSystemConnectorRouteRecord = {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  action_class: MerlinSystemConnectorActionClass;
  auth: 'authenticated' | 'owner' | 'admin' | 'public';
  purpose: string;
};

export type MerlinSystemConnectorRecord = {
  id: string;
  source_key: string;
  brand: 'MEALSCOUT' | 'TRADESCOUT';
  label: string;
  repo_path: string;
  mode: MerlinSystemConnectorMode;
  auth_surface: string;
  supported_entity_types: string[];
  supported_media_inputs: string[];
  read_capabilities: string[];
  stage_capabilities: string[];
  execute_capabilities: string[];
  route_inventory: MerlinSystemConnectorRouteRecord[];
  current_blockers: string[];
  created_at: string;
  updated_at: string;
};

const NOW = '2026-07-01T00:00:00.000Z';

const CONNECTORS: MerlinSystemConnectorRecord[] = [
  {
    id: 'merlin-system-connector-mealscout',
    source_key: 'mealscout',
    brand: 'MEALSCOUT',
    label: 'MealScout Connector',
    repo_path: 'D:\\AAATraderCorner\\TradeScout\\MealScout',
    mode: 'browser_session',
    auth_surface: 'Express session with restaurant-owner and business-team ownership checks',
    supported_entity_types: ['food_truck', 'restaurant', 'host_location', 'event'],
    supported_media_inputs: ['image', 'pdf', 'text', 'csv', 'xlsx', 'json'],
    read_capabilities: [
      'read_authenticated_user_settings',
      'read_owned_restaurants',
      'read_owned_menus',
      'read_restaurant_stats',
      'read_booking_schedule',
      'read_business_team_context'
    ],
    stage_capabilities: [
      'stage_account_profile_changes',
      'stage_operating_hours_changes',
      'stage_location_changes',
      'stage_social_settings_changes',
      'stage_menu_crud',
      'stage_media_uploads'
    ],
    execute_capabilities: [
      'update_user_settings',
      'update_restaurant_mobile_settings',
      'update_restaurant_location',
      'update_restaurant_operating_hours',
      'update_restaurant_social_settings',
      'create_update_delete_menu_structures',
      'upload_restaurant_logo_cover_and_deal_media'
    ],
    route_inventory: [
      {
        method: 'GET',
        path: '/api/settings/me',
        action_class: 'read',
        auth: 'authenticated',
        purpose: 'Read the authenticated MealScout account settings.'
      },
      {
        method: 'PATCH',
        path: '/api/settings/me',
        action_class: 'execute',
        auth: 'authenticated',
        purpose: 'Update the authenticated MealScout account settings.'
      },
      {
        method: 'GET',
        path: '/api/restaurants/my',
        action_class: 'read',
        auth: 'owner',
        purpose: 'List the current owner-owned restaurants.'
      },
      {
        method: 'GET',
        path: '/api/restaurants/my-restaurants',
        action_class: 'read',
        auth: 'authenticated',
        purpose: 'Read owned and collaborator restaurants for the logged-in user.'
      },
      {
        method: 'GET',
        path: '/api/owner/menus/:restaurantId',
        action_class: 'read',
        auth: 'owner',
        purpose: 'Read all menus for an owned restaurant.'
      },
      {
        method: 'POST',
        path: '/api/owner/menus/:restaurantId',
        action_class: 'execute',
        auth: 'owner',
        purpose: 'Create a menu for an owned restaurant.'
      },
      {
        method: 'PATCH',
        path: '/api/menus/:menuId',
        action_class: 'execute',
        auth: 'owner',
        purpose: 'Update an owned menu.'
      },
      {
        method: 'POST',
        path: '/api/menus/:menuId/categories',
        action_class: 'execute',
        auth: 'owner',
        purpose: 'Create menu categories within an owned menu.'
      },
      {
        method: 'POST',
        path: '/api/menu-items',
        action_class: 'execute',
        auth: 'owner',
        purpose: 'Create menu items for an owned restaurant menu.'
      },
      {
        method: 'PUT',
        path: '/api/menus/:menuId/import',
        action_class: 'stage',
        auth: 'owner',
        purpose: 'Import menu content from CSV, PDF, JSON, or spreadsheet files.'
      },
      {
        method: 'PATCH',
        path: '/api/restaurants/:restaurantId/mobile-settings',
        action_class: 'execute',
        auth: 'owner',
        purpose: 'Update mobile online/offline settings for an owned restaurant.'
      },
      {
        method: 'PATCH',
        path: '/api/restaurants/:restaurantId/location',
        action_class: 'execute',
        auth: 'owner',
        purpose: 'Update live location and inferred city/state for an owned restaurant.'
      },
      {
        method: 'PATCH',
        path: '/api/restaurants/:restaurantId/operating-hours',
        action_class: 'execute',
        auth: 'owner',
        purpose: 'Update operating hours for an owned restaurant.'
      },
      {
        method: 'PATCH',
        path: '/api/restaurants/:restaurantId/social-settings',
        action_class: 'execute',
        auth: 'owner',
        purpose: 'Update social URLs and autopost settings for an owned restaurant.'
      },
      {
        method: 'POST',
        path: '/api/upload/restaurant-logo',
        action_class: 'execute',
        auth: 'authenticated',
        purpose: 'Upload and attach a restaurant logo for an owned restaurant.'
      },
      {
        method: 'POST',
        path: '/api/upload/restaurant-cover',
        action_class: 'execute',
        auth: 'authenticated',
        purpose: 'Upload and attach a restaurant cover image for an owned restaurant.'
      }
    ],
    current_blockers: [
      'Merlin does not yet maintain a live MealScout session bridge.',
      'Multipart upload execution is not yet normalized into Merlin execution plans.',
      'Menu/media execution is available in MealScout but not yet mapped into Merlin action contracts.'
    ],
    created_at: NOW,
    updated_at: NOW
  },
  {
    id: 'merlin-system-connector-tradescout',
    source_key: 'tradescout',
    brand: 'TRADESCOUT',
    label: 'TradeScout Connector',
    repo_path: 'D:\\AAATraderCorner\\TradeScout\\TradeScoutPro',
    mode: 'browser_session',
    auth_surface: 'Express session with authenticated owner/profile/business checks',
    supported_entity_types: ['contractor', 'business', 'profile', 'home'],
    supported_media_inputs: ['image', 'docx', 'pdf', 'json', 'text'],
    read_capabilities: [
      'read_authenticated_user_profile',
      'read_business_profile_me',
      'read_owned_profiles',
      'read_active_profile',
      'read_profile_booking_config',
      'read_business_directory_records'
    ],
    stage_capabilities: [
      'stage_user_profile_changes',
      'stage_business_profile_changes',
      'stage_multi_profile_changes',
      'stage_profile_booking_changes',
      'stage_business_claim_flow',
      'stage_object_uploads'
    ],
    execute_capabilities: [
      'update_user_profile',
      'update_auth_profile',
      'update_business_profile',
      'create_update_publish_profiles',
      'update_profile_booking_preferences',
      'create_and_update_business_records',
      'upload_public_and_private_objects'
    ],
    route_inventory: [
      {
        method: 'GET',
        path: '/api/user/profile',
        action_class: 'read',
        auth: 'authenticated',
        purpose: 'Read the authenticated TradeScout user profile.'
      },
      {
        method: 'PUT',
        path: '/api/user/profile',
        action_class: 'execute',
        auth: 'authenticated',
        purpose: 'Update the authenticated TradeScout user profile.'
      },
      {
        method: 'GET',
        path: '/api/auth/profile',
        action_class: 'read',
        auth: 'authenticated',
        purpose: 'Read the authenticated TradeScout auth/profile payload.'
      },
      {
        method: 'PUT',
        path: '/api/auth/profile',
        action_class: 'execute',
        auth: 'authenticated',
        purpose: 'Update the authenticated TradeScout auth/profile payload.'
      },
      {
        method: 'GET',
        path: '/api/business-profile/me',
        action_class: 'read',
        auth: 'authenticated',
        purpose: 'Read the published business profile for the authenticated owner.'
      },
      {
        method: 'PATCH',
        path: '/api/business-profile/me',
        action_class: 'execute',
        auth: 'authenticated',
        purpose: 'Update the published business profile for the authenticated owner.'
      },
      {
        method: 'POST',
        path: '/api/business-profile/publish',
        action_class: 'execute',
        auth: 'authenticated',
        purpose: 'Publish a business profile from profile draft data.'
      },
      {
        method: 'GET',
        path: '/api/profiles',
        action_class: 'read',
        auth: 'authenticated',
        purpose: 'List all owned TradeScout profiles for the authenticated user.'
      },
      {
        method: 'POST',
        path: '/api/profiles',
        action_class: 'execute',
        auth: 'authenticated',
        purpose: 'Create a new TradeScout profile.'
      },
      {
        method: 'PUT',
        path: '/api/profiles/:id',
        action_class: 'execute',
        auth: 'authenticated',
        purpose: 'Update an owned TradeScout profile.'
      },
      {
        method: 'PUT',
        path: '/api/profiles/:id/publish',
        action_class: 'execute',
        auth: 'authenticated',
        purpose: 'Publish an owned TradeScout profile.'
      },
      {
        method: 'PUT',
        path: '/api/users/active-profile',
        action_class: 'execute',
        auth: 'authenticated',
        purpose: 'Switch the authenticated user active profile.'
      },
      {
        method: 'GET',
        path: '/api/users/profile-booking',
        action_class: 'read',
        auth: 'authenticated',
        purpose: 'Read TradeScout profile booking configuration.'
      },
      {
        method: 'PATCH',
        path: '/api/users/profile-booking',
        action_class: 'execute',
        auth: 'authenticated',
        purpose: 'Update TradeScout profile booking configuration.'
      },
      {
        method: 'POST',
        path: '/api/businesses',
        action_class: 'execute',
        auth: 'authenticated',
        purpose: 'Create a TradeScout business record.'
      },
      {
        method: 'PUT',
        path: '/api/businesses/:id',
        action_class: 'execute',
        auth: 'authenticated',
        purpose: 'Update a TradeScout business record.'
      },
      {
        method: 'POST',
        path: '/api/objects/upload',
        action_class: 'execute',
        auth: 'authenticated',
        purpose: 'Upload a public object file into TradeScout.'
      },
      {
        method: 'POST',
        path: '/api/objects/upload-private',
        action_class: 'execute',
        auth: 'authenticated',
        purpose: 'Upload a private object file into TradeScout.'
      }
    ],
    current_blockers: [
      'Merlin does not yet maintain a live TradeScout session bridge.',
      'TradeScout object uploads and profile writes are not yet mapped to Merlin execution plans.',
      'Cross-profile selection and publish flows need normalized target resolution inside Merlin.'
    ],
    created_at: NOW,
    updated_at: NOW
  }
];

export function listMerlinSystemConnectors(filters: {
  source_key?: string;
  brand?: 'MEALSCOUT' | 'TRADESCOUT';
} = {}): MerlinSystemConnectorRecord[] {
  return CONNECTORS.filter((row) => {
    if (filters.source_key && row.source_key !== filters.source_key) return false;
    if (filters.brand && row.brand !== filters.brand) return false;
    return true;
  });
}

export function getMerlinSystemConnectorById(id: string): MerlinSystemConnectorRecord | undefined {
  return CONNECTORS.find((row) => row.id === id);
}
