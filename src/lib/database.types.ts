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
      app_users: {
        Row: {
          active: boolean
          color: string
          created_at: string
          display_name: string
          id: string
          name: string
          pin: string
          role: string
          routes: Json
          updated_at: string
        }
        Insert: {
          active?: boolean
          color?: string
          created_at?: string
          display_name: string
          id: string
          name: string
          pin: string
          role: string
          routes?: Json
          updated_at?: string
        }
        Update: {
          active?: boolean
          color?: string
          created_at?: string
          display_name?: string
          id?: string
          name?: string
          pin?: string
          role?: string
          routes?: Json
          updated_at?: string
        }
        Relationships: []
      }
      breads: {
        Row: {
          active: boolean | null
          cost_price: number | null
          created_at: string | null
          days: number[]
          id: string
          is_pj: boolean | null
          name: string
          unit: string | null
        }
        Insert: {
          active?: boolean | null
          cost_price?: number | null
          created_at?: string | null
          days?: number[]
          id: string
          is_pj?: boolean | null
          name: string
          unit?: string | null
        }
        Update: {
          active?: boolean | null
          cost_price?: number | null
          created_at?: string | null
          days?: number[]
          id?: string
          is_pj?: boolean | null
          name?: string
          unit?: string | null
        }
        Relationships: []
      }
      descartes: {
        Row: {
          created_at: string | null
          id: string
          obs: string | null
          product_id: string | null
          product_source: string | null
          quantity: number
          record_date: string
          responsible: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          obs?: string | null
          product_id?: string | null
          product_source?: string | null
          quantity?: number
          record_date: string
          responsible: string
        }
        Update: {
          created_at?: string | null
          id?: string
          obs?: string | null
          product_id?: string | null
          product_source?: string | null
          quantity?: number
          record_date?: string
          responsible?: string
        }
        Relationships: []
      }
      destinations: {
        Row: {
          active: boolean | null
          code: string
          created_at: string | null
          id: string
          name: string
          requires_conferencia: boolean | null
          type: string
        }
        Insert: {
          active?: boolean | null
          code: string
          created_at?: string | null
          id?: string
          name: string
          requires_conferencia?: boolean | null
          type?: string
        }
        Update: {
          active?: boolean | null
          code?: string
          created_at?: string | null
          id?: string
          name?: string
          requires_conferencia?: boolean | null
          type?: string
        }
        Relationships: []
      }
      frozen_movements: {
        Row: {
          created_at: string | null
          frozen_product_id: string
          id: string
          location: string
          movement_type: string
          obs: string | null
          previous_quantity: number
          quantity: number
          responsible: string
        }
        Insert: {
          created_at?: string | null
          frozen_product_id: string
          id?: string
          location: string
          movement_type: string
          obs?: string | null
          previous_quantity?: number
          quantity: number
          responsible?: string
        }
        Update: {
          created_at?: string | null
          frozen_product_id?: string
          id?: string
          location?: string
          movement_type?: string
          obs?: string | null
          previous_quantity?: number
          quantity?: number
          responsible?: string
        }
        Relationships: [
          {
            foreignKeyName: "frozen_movements_frozen_product_id_fkey"
            columns: ["frozen_product_id"]
            isOneToOne: false
            referencedRelation: "frozen_products"
            referencedColumns: ["id"]
          },
        ]
      }
      frozen_products: {
        Row: {
          active: boolean
          created_at: string | null
          id: string
          min_stock: number
          product_id: string | null
          product_name: string
          product_source: string
          unit: string
        }
        Insert: {
          active?: boolean
          created_at?: string | null
          id?: string
          min_stock?: number
          product_id?: string | null
          product_name: string
          product_source?: string
          unit?: string
        }
        Update: {
          active?: boolean
          created_at?: string | null
          id?: string
          min_stock?: number
          product_id?: string | null
          product_name?: string
          product_source?: string
          unit?: string
        }
        Relationships: []
      }
      frozen_stock: {
        Row: {
          frozen_product_id: string
          id: string
          location: string
          quantity: number
          updated_at: string | null
        }
        Insert: {
          frozen_product_id: string
          id?: string
          location: string
          quantity?: number
          updated_at?: string | null
        }
        Update: {
          frozen_product_id?: string
          id?: string
          location?: string
          quantity?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "frozen_stock_frozen_product_id_fkey"
            columns: ["frozen_product_id"]
            isOneToOne: false
            referencedRelation: "frozen_products"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          bread_id: string
          id: string
          obs: string | null
          order_date: string
          pj_client: string | null
          pj_delivery_date: string | null
          quantity: number | null
          store: string
          updated_at: string | null
        }
        Insert: {
          bread_id: string
          id?: string
          obs?: string | null
          order_date?: string
          pj_client?: string | null
          pj_delivery_date?: string | null
          quantity?: number | null
          store: string
          updated_at?: string | null
        }
        Update: {
          bread_id?: string
          id?: string
          obs?: string | null
          order_date?: string
          pj_client?: string | null
          pj_delivery_date?: string | null
          quantity?: number | null
          store?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      product_prices: {
        Row: {
          active: boolean | null
          created_at: string | null
          destination_id: string | null
          id: string
          product_id: string
          product_name: string
          product_source: string
          unit_price: number
        }
        Insert: {
          active?: boolean | null
          created_at?: string | null
          destination_id?: string | null
          id?: string
          product_id: string
          product_name: string
          product_source?: string
          unit_price?: number
        }
        Update: {
          active?: boolean | null
          created_at?: string | null
          destination_id?: string | null
          id?: string
          product_id?: string
          product_name?: string
          product_source?: string
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "product_prices_destination_id_fkey"
            columns: ["destination_id"]
            isOneToOne: false
            referencedRelation: "destinations"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          active: boolean | null
          category: string
          cost_price: number | null
          created_at: string | null
          id: string
          name: string
          sort_order: number | null
          unit: string | null
        }
        Insert: {
          active?: boolean | null
          category?: string
          cost_price?: number | null
          created_at?: string | null
          id?: string
          name: string
          sort_order?: number | null
          unit?: string | null
        }
        Update: {
          active?: boolean | null
          category?: string
          cost_price?: number | null
          created_at?: string | null
          id?: string
          name?: string
          sort_order?: number | null
          unit?: string | null
        }
        Relationships: []
      }
      purchase_items: {
        Row: {
          ad_hoc_name: string | null
          checked: boolean | null
          created_at: string | null
          id: string
          is_adhoc: boolean | null
          list_id: string | null
          product_id: string | null
          quantity: number | null
          sort_order: number | null
          unit: string | null
        }
        Insert: {
          ad_hoc_name?: string | null
          checked?: boolean | null
          created_at?: string | null
          id?: string
          is_adhoc?: boolean | null
          list_id?: string | null
          product_id?: string | null
          quantity?: number | null
          sort_order?: number | null
          unit?: string | null
        }
        Update: {
          ad_hoc_name?: string | null
          checked?: boolean | null
          created_at?: string | null
          id?: string
          is_adhoc?: boolean | null
          list_id?: string | null
          product_id?: string | null
          quantity?: number | null
          sort_order?: number | null
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_items_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "purchase_lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_lists: {
        Row: {
          completed_at: string | null
          created_at: string | null
          id: string
          sector: string
          status: string | null
          submitted_at: string | null
          submitted_by: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          id?: string
          sector: string
          status?: string | null
          submitted_at?: string | null
          submitted_by?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          id?: string
          sector?: string
          status?: string | null
          submitted_at?: string | null
          submitted_by?: string | null
        }
        Relationships: []
      }
      romaneio_items: {
        Row: {
          created_at: string | null
          divergence_reason: string | null
          id: string
          item_status: string | null
          obs: string | null
          product_id: string | null
          product_name: string
          product_source: string
          qty_accepted: number | null
          qty_received: number | null
          qty_sent: number
          romaneio_id: string | null
          unit_price: number | null
        }
        Insert: {
          created_at?: string | null
          divergence_reason?: string | null
          id?: string
          item_status?: string | null
          obs?: string | null
          product_id?: string | null
          product_name: string
          product_source?: string
          qty_accepted?: number | null
          qty_received?: number | null
          qty_sent?: number
          romaneio_id?: string | null
          unit_price?: number | null
        }
        Update: {
          created_at?: string | null
          divergence_reason?: string | null
          id?: string
          item_status?: string | null
          obs?: string | null
          product_id?: string | null
          product_name?: string
          product_source?: string
          qty_accepted?: number | null
          qty_received?: number | null
          qty_sent?: number
          romaneio_id?: string | null
          unit_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "romaneio_items_romaneio_id_fkey"
            columns: ["romaneio_id"]
            isOneToOne: false
            referencedRelation: "romaneios"
            referencedColumns: ["id"]
          },
        ]
      }
      romaneios: {
        Row: {
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string | null
          created_by: string
          destination_id: string | null
          id: string
          obs: string | null
          record_date: string
          sent_at: string | null
          sent_by: string | null
          status: string
          trip_number: number
        }
        Insert: {
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string | null
          created_by: string
          destination_id?: string | null
          id?: string
          obs?: string | null
          record_date?: string
          sent_at?: string | null
          sent_by?: string | null
          status?: string
          trip_number?: number
        }
        Update: {
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string | null
          created_by?: string
          destination_id?: string | null
          id?: string
          obs?: string | null
          record_date?: string
          sent_at?: string | null
          sent_by?: string | null
          status?: string
          trip_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "romaneios_destination_id_fkey"
            columns: ["destination_id"]
            isOneToOne: false
            referencedRelation: "destinations"
            referencedColumns: ["id"]
          },
        ]
      }
      sobras: {
        Row: {
          created_at: string | null
          id: string
          obs: string | null
          product_id: string | null
          product_source: string | null
          quantity: number
          record_date: string
          responsible: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          obs?: string | null
          product_id?: string | null
          product_source?: string | null
          quantity?: number
          record_date: string
          responsible: string
        }
        Update: {
          created_at?: string | null
          id?: string
          obs?: string | null
          product_id?: string | null
          product_source?: string | null
          quantity?: number
          record_date?: string
          responsible?: string
        }
        Relationships: []
      }
      stock_balance: {
        Row: {
          average_cost: number
          id: string
          last_updated: string | null
          product_id: string
          quantity: number
        }
        Insert: {
          average_cost?: number
          id?: string
          last_updated?: string | null
          product_id: string
          quantity?: number
        }
        Update: {
          average_cost?: number
          id?: string
          last_updated?: string | null
          product_id?: string
          quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "stock_balance_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_entries: {
        Row: {
          created_at: string | null
          created_by: string | null
          entry_date: string
          id: string
          invoice_number: string | null
          notes: string | null
          supplier_id: string | null
          total_value: number | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          entry_date?: string
          id?: string
          invoice_number?: string | null
          notes?: string | null
          supplier_id?: string | null
          total_value?: number | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          entry_date?: string
          id?: string
          invoice_number?: string | null
          notes?: string | null
          supplier_id?: string | null
          total_value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_entries_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_entry_items: {
        Row: {
          entry_id: string
          id: string
          product_id: string | null
          product_name: string
          quantity: number
          total_cost: number | null
          unit: string
          unit_cost: number
        }
        Insert: {
          entry_id: string
          id?: string
          product_id?: string | null
          product_name: string
          quantity: number
          total_cost?: number | null
          unit: string
          unit_cost: number
        }
        Update: {
          entry_id?: string
          id?: string
          product_id?: string | null
          product_name?: string
          quantity?: number
          total_cost?: number | null
          unit?: string
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "stock_entry_items_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "stock_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_entry_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_movements: {
        Row: {
          created_at: string | null
          created_by: string | null
          id: string
          movement_type: string
          notes: string | null
          product_id: string
          quantity: number
          reference_id: string | null
          reference_type: string | null
          unit_cost: number | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          movement_type: string
          notes?: string | null
          product_id: string
          quantity: number
          reference_id?: string | null
          reference_type?: string | null
          unit_cost?: number | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          movement_type?: string
          notes?: string | null
          product_id?: string
          quantity?: number
          reference_id?: string | null
          reference_type?: string | null
          unit_cost?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          active: boolean | null
          cnpj: string | null
          created_at: string | null
          email: string | null
          id: string
          name: string
          notes: string | null
          phone: string | null
        }
        Insert: {
          active?: boolean | null
          cnpj?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          phone?: string | null
        }
        Update: {
          active?: boolean | null
          cnpj?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          phone?: string | null
        }
        Relationships: []
      }
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
