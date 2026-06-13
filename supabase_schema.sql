-- ============================================================
-- IRONCORE GYM ADMIN — Supabase SQL Schema
-- Run this in your Supabase project's SQL Editor
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- MEMBERS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS members (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            TEXT        NOT NULL,
  email           TEXT        NOT NULL UNIQUE,
  auth_user_id    UUID        UNIQUE REFERENCES auth.users(id),
  phone           TEXT,
  plan            TEXT        NOT NULL DEFAULT 'Monthly'
                    CHECK (plan IN ('Monthly','Quarterly','Annual')),
  membership_type TEXT        NOT NULL DEFAULT 'Strength Training',
  due_date        DATE        NOT NULL,
  join_date       DATE        NOT NULL DEFAULT CURRENT_DATE,
  notes           TEXT,
  emergency_contact TEXT,
  health_notes    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE members ADD COLUMN IF NOT EXISTS emergency_contact TEXT;
ALTER TABLE members ADD COLUMN IF NOT EXISTS health_notes TEXT;

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER members_updated_at
  BEFORE UPDATE ON members
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- NOTIFICATIONS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS notifications (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  member_id  UUID        NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  member_name TEXT,
  member_email TEXT,
  due_date   DATE        NOT NULL,
  status     TEXT        NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','sent','failed')),
  sent_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (member_id, due_date)   -- prevent duplicate notifications per cycle
);

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS member_name TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS member_email TEXT;

-- ============================================================
-- ACTIVITY LOG TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS activity_log (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  action     TEXT        NOT NULL,   -- 'add' | 'edit' | 'delete' | 'notif'
  detail     TEXT        NOT NULL,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- Only authenticated admin users can read/write data.
-- ============================================================

ALTER TABLE members       ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_log  ENABLE ROW LEVEL SECURITY;

-- Members: authenticated users only
CREATE POLICY "Auth users can view members"
  ON members FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Auth users can insert members"
  ON members FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Auth users can update members"
  ON members FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "Auth users can delete members"
  ON members FOR DELETE USING (auth.role() = 'authenticated');

-- Notifications: authenticated users only
CREATE POLICY "Auth users can view notifications"
  ON notifications FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Auth users can insert notifications"
  ON notifications FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Auth users can update notifications"
  ON notifications FOR UPDATE USING (auth.role() = 'authenticated');

-- Activity log: authenticated users only
CREATE POLICY "Auth users can view activity_log"
  ON activity_log FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Auth users can insert activity_log"
  ON activity_log FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- ============================================================
-- HELPER VIEW: members with status
-- ============================================================
CREATE OR REPLACE VIEW members_with_status AS
SELECT
  *,
  (due_date - CURRENT_DATE)        AS days_until_due,
  CASE
    WHEN due_date < CURRENT_DATE              THEN 'overdue'
    WHEN due_date <= CURRENT_DATE + INTERVAL '2 days' THEN 'expiring'
    ELSE 'active'
  END                               AS status
FROM members;
