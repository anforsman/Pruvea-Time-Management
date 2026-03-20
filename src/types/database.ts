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
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      approval_log: {
        Row: {
          action: Database["public"]["Enums"]["approval_action"]
          created_at: string | null
          entry_id: string | null
          id: string
          notes: string | null
          performed_by: string | null
          summary_id: string | null
        }
        Insert: {
          action: Database["public"]["Enums"]["approval_action"]
          created_at?: string | null
          entry_id?: string | null
          id?: string
          notes?: string | null
          performed_by?: string | null
          summary_id?: string | null
        }
        Update: {
          action?: Database["public"]["Enums"]["approval_action"]
          created_at?: string | null
          entry_id?: string | null
          id?: string
          notes?: string | null
          performed_by?: string | null
          summary_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "approval_log_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "time_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_log_performed_by_fkey"
            columns: ["performed_by"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_log_summary_id_fkey"
            columns: ["summary_id"]
            isOneToOne: false
            referencedRelation: "weekly_summaries"
            referencedColumns: ["id"]
          },
        ]
      }
      blocks: {
        Row: {
          acreage: number | null
          aliases: string[] | null
          created_at: string | null
          id: string
          name: string
          row_range: string | null
          varietal: string | null
          vineyard_id: string
        }
        Insert: {
          acreage?: number | null
          aliases?: string[] | null
          created_at?: string | null
          id?: string
          name: string
          row_range?: string | null
          varietal?: string | null
          vineyard_id: string
        }
        Update: {
          acreage?: number | null
          aliases?: string[] | null
          created_at?: string | null
          id?: string
          name?: string
          row_range?: string | null
          varietal?: string | null
          vineyard_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "blocks_vineyard_id_fkey"
            columns: ["vineyard_id"]
            isOneToOne: false
            referencedRelation: "vineyards"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_state: {
        Row: {
          context: Json | null
          id: string
          pending_entry_id: string | null
          state: Database["public"]["Enums"]["conversation_state_type"] | null
          updated_at: string | null
          worker_id: string
        }
        Insert: {
          context?: Json | null
          id?: string
          pending_entry_id?: string | null
          state?: Database["public"]["Enums"]["conversation_state_type"] | null
          updated_at?: string | null
          worker_id: string
        }
        Update: {
          context?: Json | null
          id?: string
          pending_entry_id?: string | null
          state?: Database["public"]["Enums"]["conversation_state_type"] | null
          updated_at?: string | null
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_state_pending_entry_id_fkey"
            columns: ["pending_entry_id"]
            isOneToOne: false
            referencedRelation: "time_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_state_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: true
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
        ]
      }
      crews: {
        Row: {
          created_at: string | null
          default_block_id: string | null
          default_vineyard_id: string | null
          id: string
          name: string
        }
        Insert: {
          created_at?: string | null
          default_block_id?: string | null
          default_vineyard_id?: string | null
          id?: string
          name: string
        }
        Update: {
          created_at?: string | null
          default_block_id?: string | null
          default_vineyard_id?: string | null
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "crews_default_block_id_fkey"
            columns: ["default_block_id"]
            isOneToOne: false
            referencedRelation: "blocks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crews_default_vineyard_id_fkey"
            columns: ["default_vineyard_id"]
            isOneToOne: false
            referencedRelation: "vineyards"
            referencedColumns: ["id"]
          },
        ]
      }
      lease_agreements: {
        Row: {
          created_at: string | null
          end_date: string | null
          id: string
          lessee_name: string
          start_date: string
          vineyard_id: string
        }
        Insert: {
          created_at?: string | null
          end_date?: string | null
          id?: string
          lessee_name: string
          start_date: string
          vineyard_id: string
        }
        Update: {
          created_at?: string | null
          end_date?: string | null
          id?: string
          lessee_name?: string
          start_date?: string
          vineyard_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lease_agreements_vineyard_id_fkey"
            columns: ["vineyard_id"]
            isOneToOne: false
            referencedRelation: "vineyards"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_schedule: {
        Row: {
          created_at: string | null
          cron_expression: string
          id: string
          is_active: boolean | null
          message_template_en: string
          message_template_es: string
          name: string
        }
        Insert: {
          created_at?: string | null
          cron_expression: string
          id?: string
          is_active?: boolean | null
          message_template_en: string
          message_template_es: string
          name: string
        }
        Update: {
          created_at?: string | null
          cron_expression?: string
          id?: string
          is_active?: boolean | null
          message_template_en?: string
          message_template_es?: string
          name?: string
        }
        Relationships: []
      }
      raw_messages: {
        Row: {
          body: string | null
          created_at: string | null
          direction: Database["public"]["Enums"]["message_direction"] | null
          from_number: string
          id: string
          media_urls: string[] | null
          twilio_sid: string
          worker_id: string | null
        }
        Insert: {
          body?: string | null
          created_at?: string | null
          direction?: Database["public"]["Enums"]["message_direction"] | null
          from_number: string
          id?: string
          media_urls?: string[] | null
          twilio_sid: string
          worker_id?: string | null
        }
        Update: {
          body?: string | null
          created_at?: string | null
          direction?: Database["public"]["Enums"]["message_direction"] | null
          from_number?: string
          id?: string
          media_urls?: string[] | null
          twilio_sid?: string
          worker_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "raw_messages_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          aliases: string[] | null
          category: string | null
          created_at: string | null
          id: string
          name: string
        }
        Insert: {
          aliases?: string[] | null
          category?: string | null
          created_at?: string | null
          id?: string
          name: string
        }
        Update: {
          aliases?: string[] | null
          category?: string | null
          created_at?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      time_entries: {
        Row: {
          ai_confidence: number | null
          block_id: string | null
          created_at: string | null
          date: string
          hours: number
          id: string
          notes: string | null
          source_message_id: string | null
          status: Database["public"]["Enums"]["entry_status"] | null
          task_id: string | null
          updated_at: string | null
          vineyard_id: string | null
          worker_id: string
        }
        Insert: {
          ai_confidence?: number | null
          block_id?: string | null
          created_at?: string | null
          date: string
          hours: number
          id?: string
          notes?: string | null
          source_message_id?: string | null
          status?: Database["public"]["Enums"]["entry_status"] | null
          task_id?: string | null
          updated_at?: string | null
          vineyard_id?: string | null
          worker_id: string
        }
        Update: {
          ai_confidence?: number | null
          block_id?: string | null
          created_at?: string | null
          date?: string
          hours?: number
          id?: string
          notes?: string | null
          source_message_id?: string | null
          status?: Database["public"]["Enums"]["entry_status"] | null
          task_id?: string | null
          updated_at?: string | null
          vineyard_id?: string | null
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "time_entries_block_id_fkey"
            columns: ["block_id"]
            isOneToOne: false
            referencedRelation: "blocks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_entries_source_message_id_fkey"
            columns: ["source_message_id"]
            isOneToOne: false
            referencedRelation: "raw_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_entries_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_entries_vineyard_id_fkey"
            columns: ["vineyard_id"]
            isOneToOne: false
            referencedRelation: "vineyards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_entries_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
        ]
      }
      vineyards: {
        Row: {
          created_at: string | null
          id: string
          name: string
          owner_name: string | null
          region: string | null
          total_acres: number | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
          owner_name?: string | null
          region?: string | null
          total_acres?: number | null
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
          owner_name?: string | null
          region?: string | null
          total_acres?: number | null
        }
        Relationships: []
      }
      weekly_summaries: {
        Row: {
          created_at: string | null
          id: string
          status: Database["public"]["Enums"]["summary_status"] | null
          total_hours: number
          week_start: string
          worker_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          status?: Database["public"]["Enums"]["summary_status"] | null
          total_hours: number
          week_start: string
          worker_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          status?: Database["public"]["Enums"]["summary_status"] | null
          total_hours?: number
          week_start?: string
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "weekly_summaries_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
        ]
      }
      workers: {
        Row: {
          created_at: string | null
          crew_id: string | null
          full_name: string
          hourly_rate: number | null
          id: string
          is_active: boolean | null
          language: Database["public"]["Enums"]["language_pref"] | null
          phone: string | null
          reports_to: string | null
          type: Database["public"]["Enums"]["worker_type"] | null
        }
        Insert: {
          created_at?: string | null
          crew_id?: string | null
          full_name: string
          hourly_rate?: number | null
          id?: string
          is_active?: boolean | null
          language?: Database["public"]["Enums"]["language_pref"] | null
          phone?: string | null
          reports_to?: string | null
          type?: Database["public"]["Enums"]["worker_type"] | null
        }
        Update: {
          created_at?: string | null
          crew_id?: string | null
          full_name?: string
          hourly_rate?: number | null
          id?: string
          is_active?: boolean | null
          language?: Database["public"]["Enums"]["language_pref"] | null
          phone?: string | null
          reports_to?: string | null
          type?: Database["public"]["Enums"]["worker_type"] | null
        }
        Relationships: [
          {
            foreignKeyName: "workers_crew_id_fkey"
            columns: ["crew_id"]
            isOneToOne: false
            referencedRelation: "crews"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workers_reports_to_fkey"
            columns: ["reports_to"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      approval_action: "approved" | "rejected" | "edited" | "disputed"
      conversation_state_type:
        | "idle"
        | "awaiting_confirmation"
        | "awaiting_correction"
        | "awaiting_identification"
      entry_status:
        | "draft"
        | "worker_confirmed"
        | "supervisor_approved"
        | "rejected"
        | "edited"
      language_pref: "en" | "es"
      message_direction: "inbound" | "outbound"
      summary_status: "pending" | "approved" | "disputed"
      worker_type: "standard" | "elevated"
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
      approval_action: ["approved", "rejected", "edited", "disputed"],
      conversation_state_type: [
        "idle",
        "awaiting_confirmation",
        "awaiting_correction",
        "awaiting_identification",
      ],
      entry_status: [
        "draft",
        "worker_confirmed",
        "supervisor_approved",
        "rejected",
        "edited",
      ],
      language_pref: ["en", "es"],
      message_direction: ["inbound", "outbound"],
      summary_status: ["pending", "approved", "disputed"],
      worker_type: ["standard", "elevated"],
    },
  },
} as const
