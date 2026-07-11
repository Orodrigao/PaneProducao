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
          store: string | null
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
          store?: string | null
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
          store?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      bread_movements: {
        Row: {
          bread_id: string
          created_at: string | null
          id: string
          location: string
          lot_id: string | null
          movement_type: string
          obs: string | null
          quantity: number
          recorded_by: string
          reference_id: string | null
          reference_type: string | null
        }
        Insert: {
          bread_id: string
          created_at?: string | null
          id?: string
          location: string
          lot_id?: string | null
          movement_type: string
          obs?: string | null
          quantity: number
          recorded_by: string
          reference_id?: string | null
          reference_type?: string | null
        }
        Update: {
          bread_id?: string
          created_at?: string | null
          id?: string
          location?: string
          lot_id?: string | null
          movement_type?: string
          obs?: string | null
          quantity?: number
          recorded_by?: string
          reference_id?: string | null
          reference_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bread_movements_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "production_actuals"
            referencedColumns: ["id"]
          },
        ]
      }
      breads: {
        Row: {
          active: boolean | null
          cost_price: number | null
          created_at: string | null
          days: number[]
          id: string
          is_pj: boolean | null
          is_shelf: boolean
          is_special: boolean
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
          is_shelf?: boolean
          is_special?: boolean
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
          is_shelf?: boolean
          is_special?: boolean
          name?: string
          unit?: string | null
        }
        Relationships: []
      }
      customer_price_overrides: {
        Row: {
          active: boolean
          created_at: string
          customer_id: string
          id: string
          pack_size: number
          pricing_unit: string
          product_id: string
          product_name: string
          product_source: string
          sale_option_id: string | null
          unit_price: number
        }
        Insert: {
          active?: boolean
          created_at?: string
          customer_id: string
          id?: string
          pack_size?: number
          pricing_unit?: string
          product_id: string
          product_name: string
          product_source: string
          sale_option_id?: string | null
          unit_price: number
        }
        Update: {
          active?: boolean
          created_at?: string
          customer_id?: string
          id?: string
          pack_size?: number
          pricing_unit?: string
          product_id?: string
          product_name?: string
          product_source?: string
          sale_option_id?: string | null
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "customer_price_overrides_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          active: boolean
          contact: string | null
          created_at: string
          default_tier_id: string | null
          delivery_hours: number
          discount_pct: number
          doc: string | null
          id: string
          name: string
          notes: string | null
        }
        Insert: {
          active?: boolean
          contact?: string | null
          created_at?: string
          default_tier_id?: string | null
          delivery_hours?: number
          discount_pct?: number
          doc?: string | null
          id?: string
          name: string
          notes?: string | null
        }
        Update: {
          active?: boolean
          contact?: string | null
          created_at?: string
          default_tier_id?: string | null
          delivery_hours?: number
          discount_pct?: number
          doc?: string | null
          id?: string
          name?: string
          notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customers_default_tier_id_fkey"
            columns: ["default_tier_id"]
            isOneToOne: false
            referencedRelation: "price_tiers"
            referencedColumns: ["id"]
          },
        ]
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
          store: string | null
          unit: string
          visible_stores: string[] | null
        }
        Insert: {
          active?: boolean
          created_at?: string | null
          id?: string
          min_stock?: number
          product_id?: string | null
          product_name: string
          product_source?: string
          store?: string | null
          unit?: string
          visible_stores?: string[] | null
        }
        Update: {
          active?: boolean
          created_at?: string | null
          id?: string
          min_stock?: number
          product_id?: string | null
          product_name?: string
          product_source?: string
          store?: string | null
          unit?: string
          visible_stores?: string[] | null
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
          customer_id: string | null
          delivery_date: string | null
          id: string
          obs: string | null
          order_date: string
          order_type: string
          pack_size: number | null
          pj_client: string | null
          pj_delivery_date: string | null
          pricing_unit: string | null
          product_name: string | null
          product_source: string | null
          production_date: string | null
          quantity: number | null
          sale_option_id: string | null
          store: string
          unit_price: number | null
          updated_at: string | null
          walkin_name: string | null
          walkin_phone: string | null
        }
        Insert: {
          bread_id: string
          customer_id?: string | null
          delivery_date?: string | null
          id?: string
          obs?: string | null
          order_date?: string
          order_type?: string
          pack_size?: number | null
          pj_client?: string | null
          pj_delivery_date?: string | null
          pricing_unit?: string | null
          product_name?: string | null
          product_source?: string | null
          production_date?: string | null
          quantity?: number | null
          sale_option_id?: string | null
          store: string
          unit_price?: number | null
          updated_at?: string | null
          walkin_name?: string | null
          walkin_phone?: string | null
        }
        Update: {
          bread_id?: string
          customer_id?: string | null
          delivery_date?: string | null
          id?: string
          obs?: string | null
          order_date?: string
          order_type?: string
          pack_size?: number | null
          pj_client?: string | null
          pj_delivery_date?: string | null
          pricing_unit?: string | null
          product_name?: string | null
          product_source?: string | null
          production_date?: string | null
          quantity?: number | null
          sale_option_id?: string | null
          store?: string
          unit_price?: number | null
          updated_at?: string | null
          walkin_name?: string | null
          walkin_phone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      price_tier_items: {
        Row: {
          active: boolean
          created_at: string
          id: string
          pack_size: number
          pricing_unit: string
          product_id: string
          product_name: string
          product_source: string
          sale_option_id: string | null
          tier_id: string
          unit_price: number
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          pack_size?: number
          pricing_unit?: string
          product_id: string
          product_name: string
          product_source: string
          sale_option_id?: string | null
          tier_id: string
          unit_price: number
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          pack_size?: number
          pricing_unit?: string
          product_id?: string
          product_name?: string
          product_source?: string
          sale_option_id?: string | null
          tier_id?: string
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "price_tier_items_tier_id_fkey"
            columns: ["tier_id"]
            isOneToOne: false
            referencedRelation: "price_tiers"
            referencedColumns: ["id"]
          },
        ]
      }
      price_tiers: {
        Row: {
          active: boolean
          created_at: string
          description: string | null
          id: string
          name: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          description?: string | null
          id?: string
          name: string
        }
        Update: {
          active?: boolean
          created_at?: string
          description?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      product_components: {
        Row: {
          component_id: string
          component_source: string
          created_at: string
          id: string
          parent_product_id: string
          quantity: number
        }
        Insert: {
          component_id: string
          component_source: string
          created_at?: string
          id?: string
          parent_product_id: string
          quantity?: number
        }
        Update: {
          component_id?: string
          component_source?: string
          created_at?: string
          id?: string
          parent_product_id?: string
          quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "product_components_parent_product_id_fkey"
            columns: ["parent_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_recipe_yields: {
        Row: {
          average_unit_weight_kg: number | null
          bake_loss_pct: number | null
          basis: string
          batch_name: string | null
          created_at: string
          dough_weight_kg: number | null
          finished_weight_kg: number | null
          id: string
          notes: string | null
          product_id: string
          updated_at: string | null
          yield_units: number | null
        }
        Insert: {
          basis?: string
          batch_name?: string | null
          created_at?: string
          dough_weight_kg?: number | null
          finished_weight_kg?: number | null
          id?: string
          notes?: string | null
          product_id: string
          updated_at?: string | null
          yield_units?: number | null
        }
        Update: {
          basis?: string
          batch_name?: string | null
          dough_weight_kg?: number | null
          finished_weight_kg?: number | null
          id?: string
          notes?: string | null
          product_id?: string
          updated_at?: string | null
          yield_units?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "product_recipe_yields_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_sale_options: {
        Row: {
          active: boolean
          created_at: string
          id: string
          is_default: boolean
          name: string
          product_id: string
          reference_quantity: number
          sale_unit: string
          unit_weight_kg: number | null
          updated_at: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          is_default?: boolean
          name: string
          product_id: string
          reference_quantity?: number
          sale_unit: string
          unit_weight_kg?: number | null
          updated_at?: string | null
        }
        Update: {
          active?: boolean
          id?: string
          is_default?: boolean
          name?: string
          product_id?: string
          reference_quantity?: number
          sale_unit?: string
          unit_weight_kg?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_sale_options_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
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
      product_production: {
        Row: {
          id: string
          obs: string | null
          product_id: string
          production_date: string
          quantity: number
          store: string
          updated_at: string | null
        }
        Insert: {
          id?: string
          obs?: string | null
          product_id: string
          production_date: string
          quantity?: number
          store?: string
          updated_at?: string | null
        }
        Update: {
          id?: string
          obs?: string | null
          product_id?: string
          production_date?: string
          quantity?: number
          store?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_production_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      production_actuals: {
        Row: {
          bread_id: string
          created_at: string | null
          id: string
          lot_code: string
          loss_reason: string | null
          obs: string | null
          quantity_baked: number
          quantity_loss: number
          record_date: string
          recorded_by: string
          updated_at: string | null
        }
        Insert: {
          bread_id: string
          created_at?: string | null
          id?: string
          lot_code: string
          loss_reason?: string | null
          obs?: string | null
          quantity_baked?: number
          quantity_loss?: number
          record_date: string
          recorded_by: string
          updated_at?: string | null
        }
        Update: {
          bread_id?: string
          created_at?: string | null
          id?: string
          lot_code?: string
          loss_reason?: string | null
          obs?: string | null
          quantity_baked?: number
          quantity_loss?: number
          record_date?: string
          recorded_by?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      production_actual_events: {
        Row: {
          bread_id: string
          changed_by: string
          changed_by_name: string
          created_at: string
          id: string
          loss_reason: string | null
          lot_code: string
          previous_quantity_baked: number | null
          previous_quantity_loss: number | null
          production_actual_id: string
          quantity_baked: number
          quantity_loss: number
          record_date: string
        }
        Insert: {
          bread_id: string
          changed_by: string
          changed_by_name: string
          created_at?: string
          id?: string
          loss_reason?: string | null
          lot_code: string
          previous_quantity_baked?: number | null
          previous_quantity_loss?: number | null
          production_actual_id: string
          quantity_baked: number
          quantity_loss: number
          record_date: string
        }
        Update: {
          bread_id?: string
          changed_by?: string
          changed_by_name?: string
          created_at?: string
          id?: string
          loss_reason?: string | null
          lot_code?: string
          previous_quantity_baked?: number | null
          previous_quantity_loss?: number | null
          production_actual_id?: string
          quantity_baked?: number
          quantity_loss?: number
          record_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_actual_events_production_actual_id_fkey"
            columns: ["production_actual_id"]
            isOneToOne: false
            referencedRelation: "production_actuals"
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
          is_fabricacao_propria: boolean
          is_pj: boolean
          is_revenda: boolean
          is_shelf: boolean
          is_special: boolean
          kind: string | null
          legacy_bread_id: string | null
          name: string
          production_area: string | null
          production_days: number[]
          sort_order: number | null
          unit: string | null
        }
        Insert: {
          active?: boolean | null
          category?: string
          cost_price?: number | null
          created_at?: string | null
          id?: string
          is_fabricacao_propria?: boolean
          is_pj?: boolean
          is_revenda?: boolean
          is_shelf?: boolean
          is_special?: boolean
          kind?: string | null
          legacy_bread_id?: string | null
          name: string
          production_area?: string | null
          production_days?: number[]
          sort_order?: number | null
          unit?: string | null
        }
        Update: {
          active?: boolean | null
          category?: string
          cost_price?: number | null
          created_at?: string | null
          id?: string
          is_fabricacao_propria?: boolean
          is_pj?: boolean
          is_revenda?: boolean
          is_shelf?: boolean
          is_special?: boolean
          kind?: string | null
          legacy_bread_id?: string | null
          name?: string
          production_area?: string | null
          production_days?: number[]
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
      quotation_items: {
        Row: {
          created_at: string
          id: string
          product_id: string
          quantity: number
          quotation_id: string
          unit: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          product_id: string
          quantity?: number
          quotation_id: string
          unit?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          product_id?: string
          quantity?: number
          quotation_id?: string
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quotation_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotation_items_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: false
            referencedRelation: "quotations"
            referencedColumns: ["id"]
          },
        ]
      }
      quotation_responses: {
        Row: {
          available: boolean
          created_at: string
          id: string
          notes: string | null
          product_id: string
          quotation_id: string
          supplier_id: string
          unit: string | null
          unit_price: number
        }
        Insert: {
          available?: boolean
          created_at?: string
          id?: string
          notes?: string | null
          product_id: string
          quotation_id: string
          supplier_id: string
          unit?: string | null
          unit_price: number
        }
        Update: {
          available?: boolean
          created_at?: string
          id?: string
          notes?: string | null
          product_id?: string
          quotation_id?: string
          supplier_id?: string
          unit?: string | null
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "quotation_responses_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotation_responses_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: false
            referencedRelation: "quotations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotation_responses_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      quotation_suppliers: {
        Row: {
          channel: string
          created_at: string
          generated_message: string | null
          id: string
          quotation_id: string
          sent_at: string | null
          status: string
          supplier_id: string
        }
        Insert: {
          channel?: string
          created_at?: string
          generated_message?: string | null
          id?: string
          quotation_id: string
          sent_at?: string | null
          status?: string
          supplier_id: string
        }
        Update: {
          channel?: string
          created_at?: string
          generated_message?: string | null
          id?: string
          quotation_id?: string
          sent_at?: string | null
          status?: string
          supplier_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "quotation_suppliers_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: false
            referencedRelation: "quotations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotation_suppliers_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      quotations: {
        Row: {
          created_at: string
          created_by: string
          id: string
          status: string
          week_reference: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          status?: string
          week_reference: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          status?: string
          week_reference?: string
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
      shelf_counts: {
        Row: {
          counted_by: string
          created_at: string
          id: string
          product_id: string
          product_source: string
          quantity: number
          record_date: string
          store: string
        }
        Insert: {
          counted_by: string
          created_at?: string
          id?: string
          product_id: string
          product_source: string
          quantity?: number
          record_date: string
          store: string
        }
        Update: {
          counted_by?: string
          created_at?: string
          id?: string
          product_id?: string
          product_source?: string
          quantity?: number
          record_date?: string
          store?: string
        }
        Relationships: []
      }
      bread_leftover_events: {
        Row: {
          action: string
          actor_id: string
          actor_name: string
          created_at: string
          from_location: string | null
          id: string
          obs: string | null
          quantity: number
          reuse_plan_id: string | null
          sobra_id: string
          to_location: string | null
        }
        Insert: {
          action: string
          actor_id: string
          actor_name: string
          created_at?: string
          from_location?: string | null
          id?: string
          obs?: string | null
          quantity?: number
          reuse_plan_id?: string | null
          sobra_id: string
          to_location?: string | null
        }
        Update: {
          action?: string
          actor_id?: string
          actor_name?: string
          created_at?: string
          from_location?: string | null
          id?: string
          obs?: string | null
          quantity?: number
          reuse_plan_id?: string | null
          sobra_id?: string
          to_location?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bread_leftover_events_reuse_plan_id_fkey"
            columns: ["reuse_plan_id"]
            isOneToOne: false
            referencedRelation: "bread_reuse_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bread_leftover_events_sobra_id_fkey"
            columns: ["sobra_id"]
            isOneToOne: false
            referencedRelation: "sobras"
            referencedColumns: ["id"]
          },
        ]
      }
      bread_reuse_plan_allocations: {
        Row: {
          created_at: string
          plan_id: string
          quantity: number
          sobra_id: string
        }
        Insert: {
          created_at?: string
          plan_id: string
          quantity: number
          sobra_id: string
        }
        Update: {
          created_at?: string
          plan_id?: string
          quantity?: number
          sobra_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bread_reuse_plan_allocations_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "bread_reuse_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bread_reuse_plan_allocations_sobra_id_fkey"
            columns: ["sobra_id"]
            isOneToOne: false
            referencedRelation: "sobras"
            referencedColumns: ["id"]
          },
        ]
      }
      bread_reuse_plans: {
        Row: {
          bread_id: string
          confirmed_at: string | null
          confirmed_by: string | null
          confirmed_by_name: string | null
          confirmed_quantity: number | null
          id: string
          proposed_at: string
          proposed_by: string
          proposed_by_name: string
          proposed_quantity: number
          status: string
          store: string
          target_production_date: string
          updated_at: string
        }
        Insert: {
          bread_id: string
          confirmed_at?: string | null
          confirmed_by?: string | null
          confirmed_by_name?: string | null
          confirmed_quantity?: number | null
          id?: string
          proposed_at?: string
          proposed_by: string
          proposed_by_name: string
          proposed_quantity?: number
          status?: string
          store: string
          target_production_date: string
          updated_at?: string
        }
        Update: {
          bread_id?: string
          confirmed_at?: string | null
          confirmed_by?: string | null
          confirmed_by_name?: string | null
          confirmed_quantity?: number | null
          id?: string
          proposed_at?: string
          proposed_by?: string
          proposed_by_name?: string
          proposed_quantity?: number
          status?: string
          store?: string
          target_production_date?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bread_reuse_plans_bread_id_fkey"
            columns: ["bread_id"]
            isOneToOne: false
            referencedRelation: "breads"
            referencedColumns: ["id"]
          },
        ]
      }
      sobras: {
        Row: {
          created_at: string | null
          id: string
          lot_code: string | null
          obs: string | null
          pending_quantity: number | null
          physical_location: string | null
          product_id: string | null
          product_source: string | null
          production_actual_id: string | null
          quantity: number
          record_date: string
          responsible: string
          status: string | null
          store: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          lot_code?: string | null
          obs?: string | null
          pending_quantity?: number | null
          physical_location?: string | null
          product_id?: string | null
          product_source?: string | null
          production_actual_id?: string | null
          quantity?: number
          record_date: string
          responsible: string
          status?: string | null
          store?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string | null
          id?: string
          lot_code?: string | null
          obs?: string | null
          pending_quantity?: number | null
          physical_location?: string | null
          product_id?: string | null
          product_source?: string | null
          production_actual_id?: string | null
          quantity?: number
          record_date?: string
          responsible?: string
          status?: string | null
          store?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sobras_production_actual_id_fkey"
            columns: ["production_actual_id"]
            isOneToOne: false
            referencedRelation: "production_actuals"
            referencedColumns: ["id"]
          },
        ]
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
      supplier_order_items: {
        Row: {
          created_at: string
          id: string
          product_id: string
          quantity: number
          supplier_order_id: string
          unit: string | null
          unit_price: number
        }
        Insert: {
          created_at?: string
          id?: string
          product_id: string
          quantity: number
          supplier_order_id: string
          unit?: string | null
          unit_price: number
        }
        Update: {
          created_at?: string
          id?: string
          product_id?: string
          quantity?: number
          supplier_order_id?: string
          unit?: string | null
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "supplier_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_order_items_supplier_order_id_fkey"
            columns: ["supplier_order_id"]
            isOneToOne: false
            referencedRelation: "supplier_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_orders: {
        Row: {
          created_at: string
          id: string
          notes: string | null
          quotation_id: string | null
          status: string
          supplier_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          notes?: string | null
          quotation_id?: string | null
          status?: string
          supplier_id: string
        }
        Update: {
          created_at?: string
          id?: string
          notes?: string | null
          quotation_id?: string | null
          status?: string
          supplier_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_orders_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: false
            referencedRelation: "quotations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_orders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_products: {
        Row: {
          active: boolean
          created_at: string
          default_unit: string | null
          id: string
          product_id: string
          supplier_code: string | null
          supplier_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          default_unit?: string | null
          id?: string
          product_id: string
          supplier_code?: string | null
          supplier_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          default_unit?: string | null
          id?: string
          product_id?: string
          supplier_code?: string | null
          supplier_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_products_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
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
          telegram_handle: string | null
          whatsapp_e164: string | null
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
          telegram_handle?: string | null
          whatsapp_e164?: string | null
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
          telegram_handle?: string | null
          whatsapp_e164?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      confirm_bread_reuse_plan: {
        Args: { p_confirmed_quantity: number; p_plan_id: string }
        Returns: Json
      }
      confirm_oven_output: {
        Args: {
          p_bread_id: string
          p_loss_reason?: string
          p_obs?: string
          p_quantity_good: number
          p_quantity_loss?: number
          p_record_date: string
        }
        Returns: {
          confirmed_at: string
          production_actual_id: string
          returned_loss_reason: string | null
          returned_lot_code: string
          returned_quantity_good: number
          returned_quantity_loss: number
        }[]
      }
      register_bread_leftovers: {
        Args: {
          p_items: Json
          p_physical_location?: string
          p_record_date: string
          p_store: string
        }
        Returns: Json
      }
      resolve_bread_leftover: {
        Args: {
          p_action: string
          p_freezer_location?: string
          p_quantity: number
          p_sobra_id: string
        }
        Returns: Json
      }
      save_bread_reuse_proposals: {
        Args: {
          p_proposals: Json
          p_store: string
          p_target_production_date: string
        }
        Returns: Json
      }
      update_bread_leftover_location: {
        Args: { p_physical_location: string; p_sobra_id: string }
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
  public: {
    Enums: {},
  },
} as const
