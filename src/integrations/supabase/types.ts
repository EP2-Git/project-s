export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      availabilities: {
        Row: {
          buffer_minutes: number
          created_at: string
          end_time: string
          id: string
          start_time: string
          updated_at: string
          user_id: string
          weekday: number
        }
        Insert: {
          buffer_minutes?: number
          created_at?: string
          end_time: string
          id?: string
          start_time: string
          updated_at?: string
          user_id: string
          weekday: number
        }
        Update: {
          buffer_minutes?: number
          created_at?: string
          end_time?: string
          id?: string
          start_time?: string
          updated_at?: string
          user_id?: string
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "availabilities_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      bookings: {
        Row: {
          booker_email: string
          booker_name: string
          buffer_after_minutes: number
          buffer_before_minutes: number
          canceled_at: string | null
          canceled_by: string | null
          confirmation_code: string
          created_at: string
          duration_minutes: number
          end_time: string | null
          guest_timezone: string | null
          host_timezone: string
          id: string
          idempotency_key: string
          meeting_type_id: string
          meeting_type_title: string
          notes: string | null
          occupied_during: unknown
          preparation_id: string | null
          request_fingerprint: string
          responses: Json
          start_time: string
          status: string
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          booker_email: string
          booker_name: string
          buffer_after_minutes?: number
          buffer_before_minutes?: number
          canceled_at?: string | null
          canceled_by?: string | null
          confirmation_code?: string
          created_at?: string
          duration_minutes: number
          end_time?: string | null
          guest_timezone?: string | null
          host_timezone: string
          id?: string
          idempotency_key: string
          meeting_type_id: string
          meeting_type_title: string
          notes?: string | null
          occupied_during?: unknown
          preparation_id?: string | null
          request_fingerprint: string
          responses?: Json
          start_time: string
          status?: string
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          booker_email?: string
          booker_name?: string
          buffer_after_minutes?: number
          buffer_before_minutes?: number
          canceled_at?: string | null
          canceled_by?: string | null
          confirmation_code?: string
          created_at?: string
          duration_minutes?: number
          end_time?: string | null
          guest_timezone?: string | null
          host_timezone?: string
          id?: string
          idempotency_key?: string
          meeting_type_id?: string
          meeting_type_title?: string
          notes?: string | null
          occupied_during?: unknown
          preparation_id?: string | null
          request_fingerprint?: string
          responses?: Json
          start_time?: string
          status?: string
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "bookings_meeting_type_owner_fkey"
            columns: ["meeting_type_id", "user_id"]
            isOneToOne: false
            referencedRelation: "meeting_types"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      meeting_types: {
        Row: {
          active: boolean
          buffer_after_minutes: number
          buffer_before_minutes: number
          created_at: string
          description: string | null
          duration_minutes: number
          id: string
          maximum_advance_days: number
          minimum_notice_minutes: number
          slot_interval_minutes: number
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          buffer_after_minutes?: number
          buffer_before_minutes?: number
          created_at?: string
          description?: string | null
          duration_minutes?: number
          id?: string
          maximum_advance_days?: number
          minimum_notice_minutes?: number
          slot_interval_minutes?: number
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          buffer_after_minutes?: number
          buffer_before_minutes?: number
          created_at?: string
          description?: string | null
          duration_minutes?: number
          id?: string
          maximum_advance_days?: number
          minimum_notice_minutes?: number
          slot_interval_minutes?: number
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meeting_types_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string
          id: string
          timezone: string
          updated_at: string
          username: string
        }
        Insert: {
          created_at?: string
          full_name: string
          id: string
          timezone?: string
          updated_at?: string
          username: string
        }
        Update: {
          created_at?: string
          full_name?: string
          id?: string
          timezone?: string
          updated_at?: string
          username?: string
        }
        Relationships: []
      }
      specific_date_availabilities: {
        Row: {
          buffer_minutes: number
          created_at: string
          date: string
          end_time: string | null
          id: string
          note: string | null
          start_time: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          buffer_minutes?: number
          created_at?: string
          date: string
          end_time?: string | null
          id?: string
          note?: string | null
          start_time?: string | null
          status: string
          updated_at?: string
          user_id: string
        }
        Update: {
          buffer_minutes?: number
          created_at?: string
          date?: string
          end_time?: string | null
          id?: string
          note?: string | null
          start_time?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "specific_date_availabilities_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      append_gateway_audit_event_v1: {
        Args: { p_context: Json; p_request: Json }
        Returns: undefined
      }
      cancel_booking_v1: {
        Args: { p_booking_id: string; p_expected_version: number }
        Returns: Json
      }
      commit_prepared_booking_v1: {
        Args: { p_context: Json; p_request: Json }
        Returns: Json
      }
      confirm_public_booking_preparation_v1: {
        Args: { p_context: Json; p_request: Json }
        Returns: Json
      }
      consume_public_rate_limit_v1: {
        Args: { p_context: Json; p_request: Json }
        Returns: Json
      }
      create_public_booking_v1: { Args: { p_request: Json }; Returns: Json }
      get_gateway_booking_page_v1: {
        Args: { p_context: Json; p_request: Json }
        Returns: Json
      }
      get_public_booking_page_v1: {
        Args: { p_username: string }
        Returns: Json
      }
      get_public_booking_preparation_v1: {
        Args: { p_context: Json; p_request: Json }
        Returns: Json
      }
      is_username_available_v1: {
        Args: { p_username: string }
        Returns: boolean
      }
      list_public_free_slots_v1: {
        Args: {
          p_date: string
          p_display_time_zone: string
          p_meeting_type_id: string
          p_username: string
        }
        Returns: Json
      }
      prepare_public_booking_v1: {
        Args: { p_context: Json; p_request: Json }
        Returns: Json
      }
      set_weekly_schedule_v1: { Args: { p_schedule: Json }; Returns: undefined }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  storage: {
    Tables: {
      buckets: {
        Row: {
          created_at: string | null
          id: string
          name: string
          owner: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id: string
          name: string
          owner?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
          owner?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      migrations: {
        Row: {
          executed_at: string | null
          hash: string
          id: number
          name: string
        }
        Insert: {
          executed_at?: string | null
          hash: string
          id: number
          name: string
        }
        Update: {
          executed_at?: string | null
          hash?: string
          id?: number
          name?: string
        }
        Relationships: []
      }
      objects: {
        Row: {
          bucket_id: string | null
          created_at: string | null
          id: string
          last_accessed_at: string | null
          metadata: Json | null
          name: string | null
          owner: string | null
          updated_at: string | null
        }
        Insert: {
          bucket_id?: string | null
          created_at?: string | null
          id?: string
          last_accessed_at?: string | null
          metadata?: Json | null
          name?: string | null
          owner?: string | null
          updated_at?: string | null
        }
        Update: {
          bucket_id?: string | null
          created_at?: string | null
          id?: string
          last_accessed_at?: string | null
          metadata?: Json | null
          name?: string | null
          owner?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "objects_bucketId_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      extension: { Args: { name: string }; Returns: string }
      filename: { Args: { name: string }; Returns: string }
      foldername: { Args: { name: string }; Returns: string[] }
      search: {
        Args: {
          bucketname: string
          levels?: number
          limits?: number
          offsets?: number
          prefix: string
        }
        Returns: {
          created_at: string
          id: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
  storage: {
    Enums: {},
  },
} as const
