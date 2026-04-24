export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      app_settings: {
        Row: {
          accent_color: string
          app_description: string
          app_name: string
          email_reply_to: string | null
          email_sender_name: string | null
          favicon_url: string | null
          gradient_css: string
          id: string
          is_singleton: boolean
          logo_url: string | null
          primary_color: string
          source_url: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          accent_color?: string
          app_description?: string
          app_name?: string
          email_reply_to?: string | null
          email_sender_name?: string | null
          favicon_url?: string | null
          gradient_css?: string
          id?: string
          is_singleton?: boolean
          logo_url?: string | null
          primary_color?: string
          source_url?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          accent_color?: string
          app_description?: string
          app_name?: string
          email_reply_to?: string | null
          email_sender_name?: string | null
          favicon_url?: string | null
          gradient_css?: string
          id?: string
          is_singleton?: boolean
          logo_url?: string | null
          primary_color?: string
          source_url?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      customer_datasets: {
        Row: {
          byte_size: number | null
          filename: string
          id: string
          is_active: boolean
          kind: string
          notes: string | null
          row_count: number | null
          storage_path: string
          uploaded_at: string
        }
        Insert: {
          byte_size?: number | null
          filename: string
          id?: string
          is_active?: boolean
          kind: string
          notes?: string | null
          row_count?: number | null
          storage_path: string
          uploaded_at?: string
        }
        Update: {
          byte_size?: number | null
          filename?: string
          id?: string
          is_active?: boolean
          kind?: string
          notes?: string | null
          row_count?: number | null
          storage_path?: string
          uploaded_at?: string
        }
        Relationships: []
      }
      data_connections: {
        Row: {
          config: Json
          created_at: string
          created_by: string | null
          enabled: boolean
          id: string
          kind: Database["public"]["Enums"]["data_connection_kind"]
          last_error: string | null
          last_run_at: string | null
          last_status: Database["public"]["Enums"]["data_run_status"] | null
          name: string
          schedule_cron: string | null
          updated_at: string
        }
        Insert: {
          config?: Json
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          id?: string
          kind: Database["public"]["Enums"]["data_connection_kind"]
          last_error?: string | null
          last_run_at?: string | null
          last_status?: Database["public"]["Enums"]["data_run_status"] | null
          name: string
          schedule_cron?: string | null
          updated_at?: string
        }
        Update: {
          config?: Json
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          id?: string
          kind?: Database["public"]["Enums"]["data_connection_kind"]
          last_error?: string | null
          last_run_at?: string | null
          last_status?: Database["public"]["Enums"]["data_run_status"] | null
          name?: string
          schedule_cron?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      data_source_files: {
        Row: {
          bytes: number | null
          connection_id: string
          created_at: string
          dataset_id: string | null
          id: string
          kind: string
          last_ingested_at: string | null
          last_seen_at: string
          remote_hash: string | null
          remote_id: string
          remote_modified_at: string | null
          remote_name: string | null
          updated_at: string
        }
        Insert: {
          bytes?: number | null
          connection_id: string
          created_at?: string
          dataset_id?: string | null
          id?: string
          kind: string
          last_ingested_at?: string | null
          last_seen_at?: string
          remote_hash?: string | null
          remote_id: string
          remote_modified_at?: string | null
          remote_name?: string | null
          updated_at?: string
        }
        Update: {
          bytes?: number | null
          connection_id?: string
          created_at?: string
          dataset_id?: string | null
          id?: string
          kind?: string
          last_ingested_at?: string | null
          last_seen_at?: string
          remote_hash?: string | null
          remote_id?: string
          remote_modified_at?: string | null
          remote_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "data_source_files_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "data_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "data_source_files_dataset_id_fkey"
            columns: ["dataset_id"]
            isOneToOne: false
            referencedRelation: "customer_datasets"
            referencedColumns: ["id"]
          },
        ]
      }
      model_runs: {
        Row: {
          artefact_paths: Json | null
          created_at: string
          databricks_run_id: string | null
          error: string | null
          finished_at: string | null
          id: string
          metrics: Json | null
          started_at: string
          status: Database["public"]["Enums"]["data_run_status"]
          triggered_by: string | null
          updated_at: string
        }
        Insert: {
          artefact_paths?: Json | null
          created_at?: string
          databricks_run_id?: string | null
          error?: string | null
          finished_at?: string | null
          id?: string
          metrics?: Json | null
          started_at?: string
          status?: Database["public"]["Enums"]["data_run_status"]
          triggered_by?: string | null
          updated_at?: string
        }
        Update: {
          artefact_paths?: Json | null
          created_at?: string
          databricks_run_id?: string | null
          error?: string | null
          finished_at?: string | null
          id?: string
          metrics?: Json | null
          started_at?: string
          status?: Database["public"]["Enums"]["data_run_status"]
          triggered_by?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      nba_rules: {
        Row: {
          channel: string
          contract_months: number
          cost_per_contact_gbp: number
          created_at: string
          description: string
          discount_pct: number
          display_order: number
          eligible_packages: string[]
          id: string
          is_active: boolean
          label: string
          min_hold_seconds: number | null
          min_loyalty_calls_90d: number | null
          min_monthly_download_gb: number | null
          min_ooc_days: number | null
          min_speed_deficit_pct: number | null
          trigger_key: string
          updated_at: string
        }
        Insert: {
          channel: string
          contract_months?: number
          cost_per_contact_gbp?: number
          created_at?: string
          description: string
          discount_pct?: number
          display_order?: number
          eligible_packages?: string[]
          id?: string
          is_active?: boolean
          label: string
          min_hold_seconds?: number | null
          min_loyalty_calls_90d?: number | null
          min_monthly_download_gb?: number | null
          min_ooc_days?: number | null
          min_speed_deficit_pct?: number | null
          trigger_key: string
          updated_at?: string
        }
        Update: {
          channel?: string
          contract_months?: number
          cost_per_contact_gbp?: number
          created_at?: string
          description?: string
          discount_pct?: number
          display_order?: number
          eligible_packages?: string[]
          id?: string
          is_active?: boolean
          label?: string
          min_hold_seconds?: number | null
          min_loyalty_calls_90d?: number | null
          min_monthly_download_gb?: number | null
          min_ooc_days?: number | null
          min_speed_deficit_pct?: number | null
          trigger_key?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          avatar_url: string | null
          created_at: string
          display_name: string | null
          email: string
          id: string
          rejected_reason: string | null
          status: Database["public"]["Enums"]["account_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email: string
          id?: string
          rejected_reason?: string | null
          status?: Database["public"]["Enums"]["account_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email?: string
          id?: string
          rejected_reason?: string | null
          status?: Database["public"]["Enums"]["account_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_active_user: { Args: { _user_id: string }; Returns: boolean }
    }
    Enums: {
      account_status: "pending" | "active" | "rejected"
      app_role: "admin" | "operator" | "analyst" | "approver"
      data_connection_kind: "databricks" | "gdrive"
      data_run_status: "pending" | "running" | "success" | "error"
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
  public: {
    Enums: {
      account_status: ["pending", "active", "rejected"],
      app_role: ["admin", "operator", "analyst", "approver"],
      data_connection_kind: ["databricks", "gdrive"],
      data_run_status: ["pending", "running", "success", "error"],
    },
  },
} as const
