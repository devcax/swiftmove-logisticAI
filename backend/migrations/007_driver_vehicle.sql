-- Driver vehicle details.

ALTER TABLE drivers
    ADD COLUMN IF NOT EXISTS vehicle_type   VARCHAR(60),
    ADD COLUMN IF NOT EXISTS license_plate  VARCHAR(30);

CREATE UNIQUE INDEX IF NOT EXISTS uq_drivers_license_plate
    ON drivers (license_plate)
    WHERE license_plate IS NOT NULL;
