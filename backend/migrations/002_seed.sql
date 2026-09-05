-- Seed data.

INSERT INTO roles (code, name) VALUES
    ('ADMIN',   'Administrator'),
    ('MANAGER', 'Operations Manager')
ON CONFLICT (code) DO NOTHING;

INSERT INTO organizations (id, name, official_whatsapp_display_name) VALUES
    ('00000000-0000-0000-0000-000000000001', 'Demo Logistics Co', 'Demo Logistics WhatsApp')
ON CONFLICT DO NOTHING;
