-- Add 'awaiting_suggestion' to conversation_state_type enum
-- Used by STORY-021 historical pattern suggestions
ALTER TYPE conversation_state_type ADD VALUE IF NOT EXISTS 'awaiting_suggestion';
