CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS users (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  full_name        VARCHAR(100) NOT NULL,
  email            VARCHAR(150) UNIQUE NOT NULL,
  phone            VARCHAR(20) UNIQUE NOT NULL,
  password_hash    TEXT NOT NULL,
  avatar_url       TEXT,
  neighbourhood    VARCHAR(100),
  city             VARCHAR(50) DEFAULT 'Lagos',
  diaspora_mode    BOOLEAN DEFAULT FALSE,
  diaspora_country VARCHAR(10),
  wallet_balance   DECIMAL(12,2) DEFAULT 0.00,
  cpp_points       INTEGER DEFAULT 0,
  cpp_tier         VARCHAR(20) DEFAULT 'Explorer',
  referral_code    VARCHAR(20) UNIQUE,
  referred_by      UUID REFERENCES users(id),
  fcm_token        TEXT,
  is_active        BOOLEAN DEFAULT TRUE,
  created_at       TIMESTAMP DEFAULT NOW(),
  updated_at       TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vendors (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_name    VARCHAR(150) NOT NULL,
  email            VARCHAR(150) UNIQUE NOT NULL,
  phone            VARCHAR(20) NOT NULL,
  password_hash    TEXT NOT NULL,
  is_verified      BOOLEAN DEFAULT FALSE,
  is_managed       BOOLEAN DEFAULT FALSE,
  payout_bank      VARCHAR(100),
  payout_account   VARCHAR(20),
  payout_name      VARCHAR(100),
  available_payout DECIMAL(12,2) DEFAULT 0.00,
  created_at       TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS venues (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vendor_id     UUID REFERENCES vendors(id) ON DELETE CASCADE,
  name          VARCHAR(150) NOT NULL,
  slug          VARCHAR(150) UNIQUE NOT NULL,
  category      VARCHAR(50) NOT NULL,
  description   TEXT,
  address       TEXT NOT NULL,
  neighbourhood VARCHAR(100) NOT NULL,
  city          VARCHAR(50) DEFAULT 'Lagos',
  latitude      DECIMAL(10,7),
  longitude     DECIMAL(10,7),
  phone         VARCHAR(20),
  price_range   SMALLINT DEFAULT 2,
  opening_hours JSONB,
  amenities     TEXT[],
  cover_image   TEXT,
  images        TEXT[],
  is_live       BOOLEAN DEFAULT FALSE,
  is_featured   BOOLEAN DEFAULT FALSE,
  avg_rating    DECIMAL(3,2) DEFAULT 0.00,
  review_count  INTEGER DEFAULT 0,
  cpp_earn_rate INTEGER DEFAULT 10,
  created_at    TIMESTAMP DEFAULT NOW(),
  updated_at    TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS events (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  venue_id       UUID REFERENCES venues(id) ON DELETE CASCADE,
  vendor_id      UUID REFERENCES vendors(id),
  name           VARCHAR(200) NOT NULL,
  description    TEXT,
  category       VARCHAR(50) NOT NULL,
  event_date     DATE NOT NULL,
  start_time     TIME NOT NULL,
  end_time       TIME,
  cover_image    TEXT,
  is_free        BOOLEAN DEFAULT FALSE,
  is_live        BOOLEAN DEFAULT FALSE,
  is_featured    BOOLEAN DEFAULT FALSE,
  total_capacity INTEGER,
  tickets_sold   INTEGER DEFAULT 0,
  created_at     TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ticket_tiers (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id    UUID REFERENCES events(id) ON DELETE CASCADE,
  name        VARCHAR(100) NOT NULL,
  description TEXT,
  price       DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  quantity    INTEGER NOT NULL,
  sold        INTEGER DEFAULT 0,
  is_active   BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS bookings (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id        UUID REFERENCES users(id),
  venue_id       UUID REFERENCES venues(id),
  event_id       UUID REFERENCES events(id),
  tier_id        UUID REFERENCES ticket_tiers(id),
  booking_type   VARCHAR(20) NOT NULL,
  quantity       INTEGER DEFAULT 1,
  unit_price     DECIMAL(12,2) NOT NULL,
  total_amount   DECIMAL(12,2) NOT NULL,
  payment_method VARCHAR(30),
  payment_ref    VARCHAR(100),
  status         VARCHAR(20) DEFAULT 'pending',
  qr_code        TEXT,
  reminder_sent  BOOLEAN DEFAULT FALSE,
  cpp_earned     INTEGER DEFAULT 0,
  created_at     TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reviews (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID REFERENCES users(id),
  venue_id          UUID REFERENCES venues(id),
  booking_id        UUID REFERENCES bookings(id),
  rating            SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  atmosphere_rating SMALLINT CHECK (atmosphere_rating BETWEEN 1 AND 5),
  service_rating    SMALLINT CHECK (service_rating BETWEEN 1 AND 5),
  value_rating      SMALLINT CHECK (value_rating BETWEEN 1 AND 5),
  review_text       TEXT,
  tags              TEXT[],
  is_approved       BOOLEAN DEFAULT TRUE,
  created_at        TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cpp_transactions (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID REFERENCES users(id),
  type       VARCHAR(20) NOT NULL,
  amount     INTEGER NOT NULL,
  description TEXT,
  booking_id UUID REFERENCES bookings(id),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID REFERENCES users(id),
  type          VARCHAR(20) NOT NULL,
  amount        DECIMAL(12,2) NOT NULL,
  balance_after DECIMAL(12,2) NOT NULL,
  description   TEXT,
  payment_ref   TEXT,
  status        VARCHAR(20) DEFAULT 'completed',
  created_at    TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS saved_venues (
  user_id    UUID REFERENCES users(id),
  venue_id   UUID REFERENCES venues(id),
  created_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (user_id, venue_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID REFERENCES users(id),
  title      VARCHAR(200) NOT NULL,
  body       TEXT NOT NULL,
  type       VARCHAR(50),
  data       JSONB,
  is_read    BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS referrals (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  referrer_id UUID REFERENCES users(id),
  referred_id UUID REFERENCES users(id),
  status      VARCHAR(20) DEFAULT 'pending',
  cpp_awarded INTEGER DEFAULT 0,
  created_at  TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_venues_city ON venues(city);
CREATE INDEX IF NOT EXISTS idx_venues_category ON venues(category);
CREATE INDEX IF NOT EXISTS idx_events_date ON events(event_date);
CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);