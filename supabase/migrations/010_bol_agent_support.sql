-- Migration 010: Bol.com AI Agent Support
-- Extends optimization_proposals table to support both Amazon and Bol.com platforms
-- Zero impact on existing Amazon MCP functionality

-- ============================================================
-- 1. Add platform discriminator column
-- ============================================================
-- Default 'amazon' ensures all existing proposals remain Amazon-only
ALTER TABLE public.optimization_proposals
  ADD COLUMN IF NOT EXISTS platform TEXT DEFAULT 'amazon';

-- Add CHECK constraint for valid platforms
ALTER TABLE public.optimization_proposals
  DROP CONSTRAINT IF EXISTS optimization_proposals_platform_check;

ALTER TABLE public.optimization_proposals
  ADD CONSTRAINT optimization_proposals_platform_check
  CHECK (platform IN ('amazon', 'bol'));

-- ============================================================
-- 2. Add bol_customer_id foreign key
-- ============================================================
ALTER TABLE public.optimization_proposals
  ADD COLUMN IF NOT EXISTS bol_customer_id UUID REFERENCES public.bol_customers(id) ON DELETE CASCADE;

-- ============================================================
-- 3. Add constraint: must have either client_id OR bol_customer_id
-- ============================================================
-- This ensures data integrity - each proposal belongs to exactly one platform
ALTER TABLE public.optimization_proposals
  DROP CONSTRAINT IF EXISTS proposals_platform_entity_check;

ALTER TABLE public.optimization_proposals
  ADD CONSTRAINT proposals_platform_entity_check
  CHECK (
    (platform = 'amazon' AND client_id IS NOT NULL AND bol_customer_id IS NULL) OR
    (platform = 'bol' AND bol_customer_id IS NOT NULL AND client_id IS NULL)
  );

-- ============================================================
-- 4. Update proposal_type CHECK constraint to include Bol.com types
-- ============================================================
-- proposal_type is a TEXT column with a CHECK constraint, not an enum
-- We need to drop and recreate the constraint with new values

-- Drop existing check constraint on proposal_type
ALTER TABLE public.optimization_proposals
  DROP CONSTRAINT IF EXISTS optimization_proposals_proposal_type_check;

-- Add new check constraint with all Amazon + Bol types
ALTER TABLE public.optimization_proposals
  ADD CONSTRAINT optimization_proposals_proposal_type_check
  CHECK (proposal_type IN (
    -- Amazon types (existing)
    'bid',
    'budget',
    'keyword',
    'targeting',
    -- Bol.com types (new)
    'bol_campaign_pause',
    'bol_campaign_budget',
    'bol_keyword_bid',
    'bol_keyword_pause',
    'bol_price_adjust'
  ));

-- ============================================================
-- 6. Add index for efficient Bol proposal queries
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_proposals_bol_customer
  ON public.optimization_proposals(bol_customer_id)
  WHERE platform = 'bol';

-- Add index on platform for faster filtering
CREATE INDEX IF NOT EXISTS idx_proposals_platform
  ON public.optimization_proposals(platform);

-- ============================================================
-- 7. Row Level Security (RLS) policies for Bol proposals
-- ============================================================
-- Allow authenticated users to view all Bol proposals
-- (same permission model as Amazon proposals)
CREATE POLICY "Users can view Bol proposals"
  ON public.optimization_proposals
  FOR SELECT
  USING (
    platform = 'bol' AND
    auth.role() = 'authenticated'
  );

-- Allow authenticated users to insert Bol proposals
CREATE POLICY "Users can create Bol proposals"
  ON public.optimization_proposals
  FOR INSERT
  WITH CHECK (
    platform = 'bol' AND
    auth.role() = 'authenticated'
  );

-- Allow authenticated users to update Bol proposals (for approval/rejection)
CREATE POLICY "Users can update Bol proposals"
  ON public.optimization_proposals
  FOR UPDATE
  USING (
    platform = 'bol' AND
    auth.role() = 'authenticated'
  );

-- ============================================================
-- 8. Comments for documentation
-- ============================================================
COMMENT ON COLUMN public.optimization_proposals.platform IS
  'Platform discriminator: amazon (default) or bol. Determines which customer FK is used.';

COMMENT ON COLUMN public.optimization_proposals.bol_customer_id IS
  'Foreign key to bol_customers table. Only populated when platform=bol.';

COMMENT ON CONSTRAINT proposals_platform_entity_check ON public.optimization_proposals IS
  'Ensures each proposal belongs to exactly one platform: either client_id (Amazon) or bol_customer_id (Bol).';

-- ============================================================
-- 9. Verification query
-- ============================================================
-- Run this after migration to verify changes:
-- SELECT
--   column_name,
--   data_type,
--   is_nullable,
--   column_default
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name = 'optimization_proposals'
--   AND column_name IN ('platform', 'bol_customer_id')
-- ORDER BY ordinal_position;

-- Check constraint values:
-- SELECT conname, pg_get_constraintdef(oid)
-- FROM pg_constraint
-- WHERE conrelid = 'public.optimization_proposals'::regclass
--   AND conname = 'optimization_proposals_proposal_type_check';
