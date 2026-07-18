export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  monitor: {
    Tables: {
      scrape_runs: {
        Row: {
          error_message: string | null
          finished_at: string | null
          id: string
          started_at: string
          status: string
          target_id: string
          tariffs_found: number
          triggered_alert: boolean
        }
        Insert: {
          error_message?: string | null
          finished_at?: string | null
          id?: string
          started_at?: string
          status?: string
          target_id: string
          tariffs_found?: number
          triggered_alert?: boolean
        }
        Update: {
          error_message?: string | null
          finished_at?: string | null
          id?: string
          started_at?: string
          status?: string
          target_id?: string
          tariffs_found?: number
          triggered_alert?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "scrape_runs_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "scrape_targets"
            referencedColumns: ["id"]
          },
        ]
      }
      scrape_targets: {
        Row: {
          created_at: string
          extraction_config: Json | null
          id: string
          is_active: boolean
          last_scrape_at: string | null
          last_scrape_error: string | null
          last_scrape_status: string | null
          logo_url: string | null
          network_area: string | null
          notes: string | null
          provider_name: string
          provider_slug: string
          sort_priority: number
          tariff_page_url: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          extraction_config?: Json | null
          id?: string
          is_active?: boolean
          last_scrape_at?: string | null
          last_scrape_error?: string | null
          last_scrape_status?: string | null
          logo_url?: string | null
          network_area?: string | null
          notes?: string | null
          provider_name: string
          provider_slug: string
          sort_priority?: number
          tariff_page_url: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          extraction_config?: Json | null
          id?: string
          is_active?: boolean
          last_scrape_at?: string | null
          last_scrape_error?: string | null
          last_scrape_status?: string | null
          logo_url?: string | null
          network_area?: string | null
          notes?: string | null
          provider_name?: string
          provider_slug?: string
          sort_priority?: number
          tariff_page_url?: string
          updated_at?: string
        }
        Relationships: []
      }
      tariff_snapshots: {
        Row: {
          base_fee_eur_per_year: number
          billing_cycle: string
          bonus_condition_text: string | null
          bonus_eur: number
          captured_at: string
          contract_commitment_months: number
          energy_price_ct_per_kwh: number
          green_energy: boolean
          id: string
          price_guarantee_months: number | null
          provider_name: string
          requires_prepayment: boolean
          source: string
          tariff_name: string
        }
        Insert: {
          base_fee_eur_per_year: number
          billing_cycle: string
          bonus_condition_text?: string | null
          bonus_eur?: number
          captured_at?: string
          contract_commitment_months?: number
          energy_price_ct_per_kwh: number
          green_energy: boolean
          id?: string
          price_guarantee_months?: number | null
          provider_name: string
          requires_prepayment?: boolean
          source?: string
          tariff_name: string
        }
        Update: {
          base_fee_eur_per_year?: number
          billing_cycle?: string
          bonus_condition_text?: string | null
          bonus_eur?: number
          captured_at?: string
          contract_commitment_months?: number
          energy_price_ct_per_kwh?: number
          green_energy?: boolean
          id?: string
          price_guarantee_months?: number | null
          provider_name?: string
          requires_prepayment?: boolean
          source?: string
          tariff_name?: string
        }
        Relationships: []
      }
    }
    Views: {
      current_tariffs: {
        Row: {
          base_fee_eur_per_year: number | null
          billing_cycle: string | null
          bonus_condition_text: string | null
          bonus_eur: number | null
          captured_at: string | null
          contract_commitment_months: number | null
          energy_price_ct_per_kwh: number | null
          green_energy: boolean | null
          id: string | null
          price_guarantee_months: number | null
          provider_name: string | null
          requires_prepayment: boolean | null
          source: string | null
          tariff_name: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  platform: {
    Tables: {
      customers: {
        Row: {
          created_at: string
          id: string
          stripe_customer_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          stripe_customer_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          stripe_customer_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      entitlements: {
        Row: {
          is_active: boolean
          note: string | null
          product: Database["platform"]["Enums"]["product_key"]
          source: Database["platform"]["Enums"]["entitlement_source"]
          updated_at: string
          user_id: string
          valid_until: string | null
        }
        Insert: {
          is_active: boolean
          note?: string | null
          product: Database["platform"]["Enums"]["product_key"]
          source: Database["platform"]["Enums"]["entitlement_source"]
          updated_at?: string
          user_id: string
          valid_until?: string | null
        }
        Update: {
          is_active?: boolean
          note?: string | null
          product?: Database["platform"]["Enums"]["product_key"]
          source?: Database["platform"]["Enums"]["entitlement_source"]
          updated_at?: string
          user_id?: string
          valid_until?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      stripe_events: {
        Row: {
          payload: Json | null
          received_at: string
          stripe_event_id: string
          type: string | null
        }
        Insert: {
          payload?: Json | null
          received_at?: string
          stripe_event_id: string
          type?: string | null
        }
        Update: {
          payload?: Json | null
          received_at?: string
          stripe_event_id?: string
          type?: string | null
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean
          created_at: string
          current_period_end: string | null
          price_id: string | null
          product: Database["platform"]["Enums"]["product_key"]
          status: string
          stripe_event_created_at: string
          stripe_subscription_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          price_id?: string | null
          product: Database["platform"]["Enums"]["product_key"]
          status: string
          stripe_event_created_at: string
          stripe_subscription_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          price_id?: string | null
          product?: Database["platform"]["Enums"]["product_key"]
          status?: string
          stripe_event_created_at?: string
          stripe_subscription_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          role: string
          user_id: string
        }
        Update: {
          created_at?: string
          role?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_entitlement: {
        Args: {
          p_product: Database["platform"]["Enums"]["product_key"]
          p_user_id: string
        }
        Returns: boolean
      }
      is_admin: { Args: never; Returns: boolean }
      status_grants_access: { Args: { p_status: string }; Returns: boolean }
    }
    Enums: {
      entitlement_source: "stripe" | "manual"
      product_key: "monitor" | "calculator_pro"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
  monitor: {
    Enums: {},
  },
  platform: {
    Enums: {
      entitlement_source: ["stripe", "manual"],
      product_key: ["monitor", "calculator_pro"],
    },
  },
  public: {
    Enums: {},
  },
} as const

