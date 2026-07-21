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
      admin_exports: {
        Row: {
          exported_at: string
          exported_by: string | null
          filter_summary: string
          id: string
          row_count: number
        }
        Insert: {
          exported_at?: string
          exported_by?: string | null
          filter_summary: string
          id?: string
          row_count: number
        }
        Update: {
          exported_at?: string
          exported_by?: string | null
          filter_summary?: string
          id?: string
          row_count?: number
        }
        Relationships: []
      }
      analyses: {
        Row: {
          analysis_kind: string
          baseline_annual_saving_eur: number
          baseline_billed_kw_after: number
          baseline_billed_kw_before: number
          computed_at: string
          created_at: string
          created_by: string | null
          customer_label: string
          engine_commit_sha: string
          engine_version: string
          id: string
          inputs: Json
          lead_id: string | null
          recommended_battery_label: string | null
          recommended_capacity_kwh: number | null
          result: Json
          site_label: string | null
          source_file_gzip: string
          source_file_name: string
          source_file_sha256: string
          supersedes_id: string | null
        }
        Insert: {
          analysis_kind: string
          baseline_annual_saving_eur: number
          baseline_billed_kw_after: number
          baseline_billed_kw_before: number
          computed_at: string
          created_at?: string
          created_by?: string | null
          customer_label: string
          engine_commit_sha: string
          engine_version: string
          id?: string
          inputs: Json
          lead_id?: string | null
          recommended_battery_label?: string | null
          recommended_capacity_kwh?: number | null
          result: Json
          site_label?: string | null
          source_file_gzip: string
          source_file_name: string
          source_file_sha256: string
          supersedes_id?: string | null
        }
        Update: {
          analysis_kind?: string
          baseline_annual_saving_eur?: number
          baseline_billed_kw_after?: number
          baseline_billed_kw_before?: number
          computed_at?: string
          created_at?: string
          created_by?: string | null
          customer_label?: string
          engine_commit_sha?: string
          engine_version?: string
          id?: string
          inputs?: Json
          lead_id?: string | null
          recommended_battery_label?: string | null
          recommended_capacity_kwh?: number | null
          result?: Json
          site_label?: string | null
          source_file_gzip?: string
          source_file_name?: string
          source_file_sha256?: string
          supersedes_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "analyses_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analyses_supersedes_id_fkey"
            columns: ["supersedes_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id"]
          },
        ]
      }
      code_redemptions: {
        Row: {
          code_id: string
          id: string
          redeemed_at: string
          user_id: string
        }
        Insert: {
          code_id: string
          id?: string
          redeemed_at?: string
          user_id: string
        }
        Update: {
          code_id?: string
          id?: string
          redeemed_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "code_redemptions_code_id_fkey"
            columns: ["code_id"]
            isOneToOne: false
            referencedRelation: "redemption_codes"
            referencedColumns: ["id"]
          },
        ]
      }
      consent_texts: {
        Row: {
          body: string
          created_at: string
          id: string
          locale: string
          purpose: Database["platform"]["Enums"]["consent_purpose"]
          valid_from: string
          version: number
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          locale?: string
          purpose: Database["platform"]["Enums"]["consent_purpose"]
          valid_from?: string
          version: number
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          locale?: string
          purpose?: Database["platform"]["Enums"]["consent_purpose"]
          valid_from?: string
          version?: number
        }
        Relationships: []
      }
      consents: {
        Row: {
          confirmed_at: string | null
          consent_text_id: string
          granted_at: string
          id: string
          lead_id: string
          source_ip: unknown
          source_key: string
          status: string
          token_expires_at: string | null
          token_hash: string | null
          user_agent: string | null
          withdrawn_at: string | null
        }
        Insert: {
          confirmed_at?: string | null
          consent_text_id: string
          granted_at?: string
          id?: string
          lead_id: string
          source_ip?: unknown
          source_key: string
          status?: string
          token_expires_at?: string | null
          token_hash?: string | null
          user_agent?: string | null
          withdrawn_at?: string | null
        }
        Update: {
          confirmed_at?: string | null
          consent_text_id?: string
          granted_at?: string
          id?: string
          lead_id?: string
          source_ip?: unknown
          source_key?: string
          status?: string
          token_expires_at?: string | null
          token_hash?: string | null
          user_agent?: string | null
          withdrawn_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "consents_consent_text_id_fkey"
            columns: ["consent_text_id"]
            isOneToOne: false
            referencedRelation: "consent_texts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consents_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consents_source_key_fkey"
            columns: ["source_key"]
            isOneToOne: false
            referencedRelation: "lead_sources"
            referencedColumns: ["key"]
          },
        ]
      }
      contract_reminders: {
        Row: {
          attempted_at: string
          contract_end_date: string
          delivered_at: string | null
          error: string | null
          lead_id: string
        }
        Insert: {
          attempted_at?: string
          contract_end_date: string
          delivered_at?: string | null
          error?: string | null
          lead_id: string
        }
        Update: {
          attempted_at?: string
          contract_end_date?: string
          delivered_at?: string | null
          error?: string | null
          lead_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contract_reminders_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
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
      email_events: {
        Row: {
          bounce_subtype: string | null
          bounce_type: string | null
          email_hash: string
          event_type: string
          id: string
          lead_id: string | null
          occurred_at: string | null
          reason: string | null
          received_at: string
        }
        Insert: {
          bounce_subtype?: string | null
          bounce_type?: string | null
          email_hash: string
          event_type: string
          id: string
          lead_id?: string | null
          occurred_at?: string | null
          reason?: string | null
          received_at?: string
        }
        Update: {
          bounce_subtype?: string | null
          bounce_type?: string | null
          email_hash?: string
          event_type?: string
          id?: string
          lead_id?: string | null
          occurred_at?: string | null
          reason?: string | null
          received_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_events_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      email_suppressions: {
        Row: {
          created_at: string
          email_hash: string
          reason: string
        }
        Insert: {
          created_at?: string
          email_hash: string
          reason: string
        }
        Update: {
          created_at?: string
          email_hash?: string
          reason?: string
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
      job_runs: {
        Row: {
          detail: string | null
          finished_at: string | null
          id: string
          items_considered: number | null
          items_processed: number | null
          job_key: string
          outcome: string | null
          started_at: string
        }
        Insert: {
          detail?: string | null
          finished_at?: string | null
          id?: string
          items_considered?: number | null
          items_processed?: number | null
          job_key: string
          outcome?: string | null
          started_at?: string
        }
        Update: {
          detail?: string | null
          finished_at?: string | null
          id?: string
          items_considered?: number | null
          items_processed?: number | null
          job_key?: string
          outcome?: string | null
          started_at?: string
        }
        Relationships: []
      }
      lead_sources: {
        Row: {
          created_at: string
          is_active: boolean
          key: string
          label: string
        }
        Insert: {
          created_at?: string
          is_active?: boolean
          key: string
          label: string
        }
        Update: {
          created_at?: string
          is_active?: boolean
          key?: string
          label?: string
        }
        Relationships: []
      }
      leads: {
        Row: {
          annual_consumption_kwh: number | null
          anonymized_at: string | null
          anonymized_by: string | null
          anonymized_by_system: boolean
          company: string | null
          contract_end_date: string | null
          created_at: string
          deletion_due_at: string
          email: string
          first_name: string | null
          first_source_key: string
          id: string
          industry: Database["platform"]["Enums"]["industry"] | null
          last_edited_by: string | null
          last_interaction_at: string
          last_name: string | null
          metering_type: string | null
          phone: string | null
          postal_code: string | null
          retention_basis: string
          status: string
          supplier: string | null
          updated_at: string
        }
        Insert: {
          annual_consumption_kwh?: number | null
          anonymized_at?: string | null
          anonymized_by?: string | null
          anonymized_by_system?: boolean
          company?: string | null
          contract_end_date?: string | null
          created_at?: string
          deletion_due_at: string
          email: string
          first_name?: string | null
          first_source_key: string
          id?: string
          industry?: Database["platform"]["Enums"]["industry"] | null
          last_edited_by?: string | null
          last_interaction_at?: string
          last_name?: string | null
          metering_type?: string | null
          phone?: string | null
          postal_code?: string | null
          retention_basis?: string
          status?: string
          supplier?: string | null
          updated_at?: string
        }
        Update: {
          annual_consumption_kwh?: number | null
          anonymized_at?: string | null
          anonymized_by?: string | null
          anonymized_by_system?: boolean
          company?: string | null
          contract_end_date?: string | null
          created_at?: string
          deletion_due_at?: string
          email?: string
          first_name?: string | null
          first_source_key?: string
          id?: string
          industry?: Database["platform"]["Enums"]["industry"] | null
          last_edited_by?: string | null
          last_interaction_at?: string
          last_name?: string | null
          metering_type?: string | null
          phone?: string | null
          postal_code?: string | null
          retention_basis?: string
          status?: string
          supplier?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "leads_first_source_key_fkey"
            columns: ["first_source_key"]
            isOneToOne: false
            referencedRelation: "lead_sources"
            referencedColumns: ["key"]
          },
        ]
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
      redemption_codes: {
        Row: {
          code: string
          created_at: string
          expires_at: string | null
          id: string
          is_active: boolean
          max_redemptions: number | null
          note: string | null
          product_key: Database["platform"]["Enums"]["product_key"]
          redemption_count: number
        }
        Insert: {
          code: string
          created_at?: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          max_redemptions?: number | null
          note?: string | null
          product_key: Database["platform"]["Enums"]["product_key"]
          redemption_count?: number
        }
        Update: {
          code?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          max_redemptions?: number | null
          note?: string | null
          product_key?: Database["platform"]["Enums"]["product_key"]
          redemption_count?: number
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
      anonymize_lead: {
        Args: { p_actor: string; p_by_system?: boolean; p_lead_id: string }
        Returns: Json
      }
      consent_effective_status: {
        Args: { p_status: string; p_token_expires_at: string }
        Returns: string
      }
      contract_reminder_lead_days: { Args: never; Returns: number }
      email_hash: { Args: { p_email: string }; Returns: string }
      has_confirmed_consent: {
        Args: {
          p_lead_id: string
          p_purpose: Database["platform"]["Enums"]["consent_purpose"]
        }
        Returns: boolean
      }
      has_entitlement: {
        Args: {
          p_product: Database["platform"]["Enums"]["product_key"]
          p_user_id: string
        }
        Returns: boolean
      }
      is_admin: { Args: never; Returns: boolean }
      is_permanent_bounce: {
        Args: { p_bounce_type: string; p_event_type: string }
        Returns: boolean
      }
      is_suppressed: { Args: { p_email: string }; Returns: boolean }
      lead_filter_summary: {
        Args: {
          p_consent_purpose?: Database["platform"]["Enums"]["consent_purpose"]
          p_consent_status?: string
          p_consumption_max?: number
          p_consumption_min?: number
          p_contract_end_from?: string
          p_contract_end_to?: string
          p_due_only?: boolean
          p_industry?: Database["platform"]["Enums"]["industry"]
          p_metering_type?: string
          p_postal_prefix?: string
          p_search?: string
          p_source_key?: string
          p_status?: string
        }
        Returns: string
      }
      leads_due_for_anonymization: {
        Args: { p_limit: number }
        Returns: {
          deletion_due_at: string
          lead_id: string
          retention_basis: string
        }[]
      }
      leads_due_for_contract_reminder: {
        Args: { p_limit: number }
        Returns: {
          contract_end_date: string
          email: string
          lead_id: string
          supplier: string
        }[]
      }
      leads_matching: {
        Args: {
          p_consent_purpose?: Database["platform"]["Enums"]["consent_purpose"]
          p_consent_status?: string
          p_consumption_max?: number
          p_consumption_min?: number
          p_contract_end_from?: string
          p_contract_end_to?: string
          p_due_only?: boolean
          p_industry?: Database["platform"]["Enums"]["industry"]
          p_metering_type?: string
          p_postal_prefix?: string
          p_search?: string
          p_source_key?: string
          p_status?: string
        }
        Returns: {
          annual_consumption_kwh: number | null
          anonymized_at: string | null
          anonymized_by: string | null
          anonymized_by_system: boolean
          company: string | null
          contract_end_date: string | null
          created_at: string
          deletion_due_at: string
          email: string
          first_name: string | null
          first_source_key: string
          id: string
          industry: Database["platform"]["Enums"]["industry"] | null
          last_edited_by: string | null
          last_interaction_at: string
          last_name: string | null
          metering_type: string | null
          phone: string | null
          postal_code: string | null
          retention_basis: string
          status: string
          supplier: string | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "leads"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      marketing_consent_state: { Args: { p_lead_id: string }; Returns: string }
      normalize_email: { Args: { p_email: string }; Returns: string }
      purpose_requires_double_opt_in: {
        Args: { p_purpose: Database["platform"]["Enums"]["consent_purpose"] }
        Returns: boolean
      }
      retention_months: { Args: { p_retention_basis: string }; Returns: number }
      run_lead_retention: {
        Args: { p_max_batch?: number; p_refuse_above?: number }
        Returns: Json
      }
      status_grants_access: { Args: { p_status: string }; Returns: boolean }
      strip_emails: { Args: { p_text: string }; Returns: string }
    }
    Enums: {
      consent_purpose:
        | "marketing_email"
        | "contract_expiry_reminder"
        | "result_delivery"
      entitlement_source: "stripe" | "manual"
      industry:
        | "baeckerei"
        | "gastronomie"
        | "handel"
        | "hotellerie"
        | "tischlerei"
        | "landwirtschaft"
        | "kuehlhaus"
        | "metallverarbeitung"
        | "buero_dienstleistung"
        | "sonstige"
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
      admin_anonymize_lead: { Args: { p_lead_id: string }; Returns: Json }
      admin_contract_reminder_health: { Args: never; Returns: Json }
      admin_create_analysis: {
        Args: {
          p_analysis_kind: string
          p_baseline_annual_saving_eur: number
          p_baseline_billed_kw_after: number
          p_baseline_billed_kw_before: number
          p_computed_at: string
          p_customer_label: string
          p_engine_commit_sha: string
          p_engine_version: string
          p_inputs: Json
          p_lead_id?: string
          p_recommended_battery_label?: string
          p_recommended_capacity_kwh?: number
          p_result: Json
          p_site_label?: string
          p_source_file: string
          p_source_file_gzip: string
          p_source_file_name: string
          p_source_file_sha256: string
          p_supersedes_id?: string
        }
        Returns: Json
      }
      admin_create_code: {
        Args: {
          p_code: string
          p_expires_at?: string
          p_max_redemptions?: number
          p_note?: string
          p_product_key: Database["platform"]["Enums"]["product_key"]
        }
        Returns: Json
      }
      admin_email_event_stats: { Args: { p_days?: number }; Returns: Json }
      admin_export_leads: {
        Args: {
          p_consent_purpose?: Database["platform"]["Enums"]["consent_purpose"]
          p_consent_status?: string
          p_consumption_max?: number
          p_consumption_min?: number
          p_contract_end_from?: string
          p_contract_end_to?: string
          p_due_only?: boolean
          p_industry?: Database["platform"]["Enums"]["industry"]
          p_metering_type?: string
          p_postal_prefix?: string
          p_search?: string
          p_source_key?: string
          p_status?: string
        }
        Returns: Json
      }
      admin_get_analysis: { Args: { p_id: string }; Returns: Json }
      admin_get_analysis_source: { Args: { p_id: string }; Returns: Json }
      admin_get_lead: { Args: { p_lead_id: string }; Returns: Json }
      admin_grant_role: {
        Args: { p_role: string; p_target_user_id: string }
        Returns: Json
      }
      admin_grant_role_by_email: {
        Args: { p_email: string; p_role: string }
        Returns: Json
      }
      admin_is_email_suppressed: { Args: { p_email: string }; Returns: Json }
      admin_lead_source_stats: { Args: never; Returns: Json }
      admin_list_admins: { Args: never; Returns: Json }
      admin_list_analyses: {
        Args: {
          p_kind?: string
          p_lead_id?: string
          p_limit?: number
          p_offset?: number
        }
        Returns: Json
      }
      admin_list_codes: { Args: never; Returns: Json }
      admin_list_customers: { Args: never; Returns: Json }
      admin_list_email_events: {
        Args: { p_lead_id?: string; p_limit?: number }
        Returns: Json
      }
      admin_list_exports: { Args: { p_limit?: number }; Returns: Json }
      admin_list_job_runs: {
        Args: { p_job_key?: string; p_limit?: number }
        Returns: Json
      }
      admin_list_leads: {
        Args: {
          p_consent_purpose?: Database["platform"]["Enums"]["consent_purpose"]
          p_consent_status?: string
          p_consumption_max?: number
          p_consumption_min?: number
          p_contract_end_from?: string
          p_contract_end_to?: string
          p_due_only?: boolean
          p_industry?: Database["platform"]["Enums"]["industry"]
          p_limit?: number
          p_metering_type?: string
          p_offset?: number
          p_postal_prefix?: string
          p_search?: string
          p_source_key?: string
          p_status?: string
        }
        Returns: Json
      }
      admin_list_scrape_targets: { Args: never; Returns: Json }
      admin_revoke_role: {
        Args: { p_role: string; p_target_user_id: string }
        Returns: Json
      }
      admin_set_code_active: {
        Args: { p_code_id: string; p_is_active: boolean }
        Returns: Json
      }
      admin_set_lead_status: {
        Args: { p_lead_id: string; p_status: string }
        Returns: Json
      }
      admin_set_scrape_target_active: {
        Args: { p_is_active: boolean; p_target_id: string }
        Returns: Json
      }
      admin_suppress_lead: { Args: { p_lead_id: string }; Returns: Json }
      admin_suppression_count: { Args: never; Returns: Json }
      admin_update_lead: {
        Args: {
          p_annual_consumption_kwh?: number
          p_company?: string
          p_contract_end_date?: string
          p_first_name?: string
          p_industry?: Database["platform"]["Enums"]["industry"]
          p_last_name?: string
          p_lead_id: string
          p_metering_type?: string
          p_phone?: string
          p_postal_code?: string
          p_supplier?: string
        }
        Returns: Json
      }
      admin_upsert_scrape_target: {
        Args: {
          p_extraction_config?: Json
          p_is_active?: boolean
          p_network_area?: string
          p_notes?: string
          p_provider_name: string
          p_provider_slug: string
          p_sort_priority?: number
          p_tariff_page_url: string
        }
        Returns: Json
      }
      admin_withdraw_consent: {
        Args: {
          p_lead_id: string
          p_purpose: Database["platform"]["Enums"]["consent_purpose"]
        }
        Returns: Json
      }
      capture_lead: {
        Args: {
          p_annual_consumption_kwh?: number
          p_company?: string
          p_contract_end_date?: string
          p_email: string
          p_first_name?: string
          p_industry?: Database["platform"]["Enums"]["industry"]
          p_last_name?: string
          p_locale?: string
          p_metering_type?: string
          p_phone?: string
          p_postal_code?: string
          p_purpose?: Database["platform"]["Enums"]["consent_purpose"]
          p_source_ip?: unknown
          p_source_key: string
          p_supplier?: string
          p_token_expires_at?: string
          p_token_hash?: string
          p_user_agent?: string
        }
        Returns: Json
      }
      claim_contract_reminder: {
        Args: { p_contract_end_date: string; p_lead_id: string }
        Returns: Json
      }
      confirm_consent: { Args: { p_token_hash: string }; Returns: Json }
      finish_contract_reminder_run: {
        Args: {
          p_detail?: string
          p_items_processed?: number
          p_outcome: string
          p_run_id: string
        }
        Returns: Json
      }
      get_active_consent_text: {
        Args: {
          p_locale?: string
          p_purpose: Database["platform"]["Enums"]["consent_purpose"]
        }
        Returns: Json
      }
      get_my_entitlement: {
        Args: { p_product: Database["platform"]["Enums"]["product_key"] }
        Returns: boolean
      }
      get_my_profile: {
        Args: never
        Returns: {
          created_at: string
          display_name: string
          user_id: string
        }[]
      }
      get_my_subscription: {
        Args: { p_product: Database["platform"]["Enums"]["product_key"] }
        Returns: {
          cancel_at_period_end: boolean
          current_period_end: string
          status: string
        }[]
      }
      get_pending_consent_by_token: {
        Args: { p_token_hash: string }
        Returns: Json
      }
      get_stripe_customer_id: { Args: { p_user_id: string }; Returns: string }
      is_admin: { Args: never; Returns: boolean }
      process_stripe_subscription_event: {
        Args: {
          p_cancel_at_period_end?: boolean
          p_current_period_end?: string
          p_event_created_at: string
          p_event_id: string
          p_event_type: string
          p_price_id?: string
          p_product: Database["platform"]["Enums"]["product_key"]
          p_status: string
          p_stripe_customer_id?: string
          p_stripe_subscription_id: string
          p_user_id: string
        }
        Returns: string
      }
      record_contract_reminder_result: {
        Args: {
          p_contract_end_date: string
          p_error?: string
          p_lead_id: string
        }
        Returns: Json
      }
      record_email_event: {
        Args: {
          p_bounce_subtype?: string
          p_bounce_type?: string
          p_email: string
          p_event_id: string
          p_event_type: string
          p_occurred_at?: string
          p_reason?: string
        }
        Returns: Json
      }
      redeem_code: { Args: { p_code: string }; Returns: string }
      run_lead_retention_job: {
        Args: { p_max_batch?: number; p_refuse_above?: number }
        Returns: Json
      }
      start_contract_reminder_run: {
        Args: { p_max_batch?: number }
        Returns: Json
      }
      suppress_email_and_withdraw_all: {
        Args: { p_lead_id: string }
        Returns: Json
      }
      upsert_stripe_customer: {
        Args: { p_stripe_customer_id: string; p_user_id: string }
        Returns: undefined
      }
      withdraw_consent: {
        Args: {
          p_lead_id: string
          p_purpose: Database["platform"]["Enums"]["consent_purpose"]
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
      consent_purpose: [
        "marketing_email",
        "contract_expiry_reminder",
        "result_delivery",
      ],
      entitlement_source: ["stripe", "manual"],
      industry: [
        "baeckerei",
        "gastronomie",
        "handel",
        "hotellerie",
        "tischlerei",
        "landwirtschaft",
        "kuehlhaus",
        "metallverarbeitung",
        "buero_dienstleistung",
        "sonstige",
      ],
      product_key: ["monitor", "calculator_pro"],
    },
  },
  public: {
    Enums: {},
  },
} as const

