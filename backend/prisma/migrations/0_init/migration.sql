-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'OPERATOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "DeviceLifecycle" AS ENUM ('REGISTERED', 'PROVISIONED', 'ACTIVE', 'FAULT', 'MAINTENANCE', 'REVOKED', 'DECOMMISSIONED');

-- CreateEnum
CREATE TYPE "CommandStatus" AS ENUM ('PENDING', 'SENT', 'ACKNOWLEDGED', 'SUCCEEDED', 'REJECTED', 'TIMED_OUT', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'VIEWER',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_sessions" (
    "id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sensor-data" (
    "id" BIGSERIAL NOT NULL,
    "temperature" DECIMAL(5,2) NOT NULL,
    "humidity" DECIMAL(5,2) NOT NULL,
    "soil_moisture" INTEGER NOT NULL,
    "soil_temperature" DECIMAL(5,2),
    "rain_detected" BOOLEAN NOT NULL,
    "water_level" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "schema_version" INTEGER,
    "message_id" TEXT,
    "sequence" INTEGER,
    "measured_at" TIMESTAMPTZ(6),
    "received_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "sensor_validity" JSONB,
    "device_id" TEXT,
    "source_mode" TEXT,

    CONSTRAINT "sensor-data_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "device_id" TEXT NOT NULL,
    "source_mode" TEXT NOT NULL,
    "lifecycle" "DeviceLifecycle" NOT NULL DEFAULT 'REGISTERED',
    "device_type" TEXT,
    "zone" TEXT,
    "firmware_version" TEXT,
    "online" BOOLEAN NOT NULL DEFAULT false,
    "relay_state" TEXT,
    "last_error" TEXT,
    "last_seen" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("device_id")
);

ALTER TABLE "devices"
    ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "audit_events" (
    "id" BIGSERIAL NOT NULL,
    "actor_user_id" TEXT,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "reason" TEXT,
    "outcome" TEXT NOT NULL,
    "details" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_assignments" (
    "user_id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "assigned_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_assignments_pkey" PRIMARY KEY ("user_id","device_id")
);

-- CreateTable
CREATE TABLE "device_commands" (
    "id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "requested_by_user_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "desired_state" BOOLEAN NOT NULL,
    "status" "CommandStatus" NOT NULL DEFAULT 'PENDING',
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "issued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ(6),
    "acknowledged_at" TIMESTAMPTZ(6),
    "actual_state" BOOLEAN,
    "result_reason" TEXT,

    CONSTRAINT "device_commands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "rule_code" TEXT NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "status" "AlertStatus" NOT NULL DEFAULT 'OPEN',
    "message" TEXT NOT NULL,
    "first_seen" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "occurrence_count" INTEGER NOT NULL DEFAULT 1,
    "acknowledged_by_user_id" TEXT,
    "acknowledged_at" TIMESTAMPTZ(6),
    "acknowledgement_note" TEXT,
    "resolved_at" TIMESTAMPTZ(6),

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "irrigation_rules" (
    "device_id" TEXT NOT NULL,
    "dry_start_moisture_percent" INTEGER NOT NULL DEFAULT 10,
    "wet_stop_moisture_percent" INTEGER NOT NULL DEFAULT 35,
    "confirmation_samples" INTEGER NOT NULL DEFAULT 3,
    "rest_minutes" INTEGER NOT NULL DEFAULT 5,
    "version" INTEGER NOT NULL DEFAULT 1,
    "applied_version" INTEGER,
    "applied_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "irrigation_rules_pkey" PRIMARY KEY ("device_id")
);

ALTER TABLE "irrigation_rules"
    ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP,
    ADD CONSTRAINT "irrigation_rules_moisture_hysteresis_check"
        CHECK ("dry_start_moisture_percent" < "wet_stop_moisture_percent"),
    ADD CONSTRAINT "irrigation_rules_dry_start_range_check"
        CHECK ("dry_start_moisture_percent" BETWEEN 0 AND 40),
    ADD CONSTRAINT "irrigation_rules_wet_stop_range_check"
        CHECK ("wet_stop_moisture_percent" BETWEEN 5 AND 80),
    ADD CONSTRAINT "irrigation_rules_confirmation_samples_range_check"
        CHECK ("confirmation_samples" BETWEEN 1 AND 10),
    ADD CONSTRAINT "irrigation_rules_rest_minutes_range_check"
        CHECK ("rest_minutes" BETWEEN 1 AND 60);

-- CreateTable
CREATE TABLE "relay-log" (
    "id" BIGSERIAL NOT NULL,
    "relay_status" BOOLEAN NOT NULL,
    "trigger_reason" TEXT NOT NULL,
    "sensor_reading_id" BIGINT NOT NULL,
    "command_id" TEXT,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "relay-log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "user_sessions_token_hash_key" ON "user_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "idx_user_sessions_user_expiry" ON "user_sessions"("user_id", "expires_at");

-- CreateIndex
CREATE INDEX "idx_sensor_data_created_at" ON "sensor-data"("created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_sensor_data_device_source_created" ON "sensor-data"("device_id", "source_mode", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_sensor_data_device_sequence" ON "sensor-data"("device_id", "sequence");

-- CreateIndex
CREATE INDEX "idx_sensor_data_soil_moisture" ON "sensor-data"("soil_moisture");

-- CreateIndex
CREATE INDEX "idx_sensor_data_soil_temperature" ON "sensor-data"("soil_temperature");

-- CreateIndex
CREATE UNIQUE INDEX "sensor_data_device_message_id_key" ON "sensor-data"("device_id", "message_id");

-- CreateIndex
CREATE INDEX "idx_devices_source_online" ON "devices"("source_mode", "online");

-- CreateIndex
CREATE INDEX "idx_audit_target_created" ON "audit_events"("target_type", "target_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_audit_actor_created" ON "audit_events"("actor_user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_device_assignments_device" ON "device_assignments"("device_id");

-- CreateIndex
CREATE INDEX "idx_device_commands_device_issued" ON "device_commands"("device_id", "issued_at" DESC);

-- CreateIndex
CREATE INDEX "idx_device_commands_status_expiry" ON "device_commands"("status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "device_commands_user_idempotency_key" ON "device_commands"("requested_by_user_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "idx_alerts_device_status_seen" ON "alerts"("device_id", "status", "last_seen" DESC);

CREATE UNIQUE INDEX "alerts_one_active_rule_per_device"
    ON "alerts"("device_id", "rule_code")
    WHERE "status" IN ('OPEN', 'ACKNOWLEDGED');

-- CreateIndex
CREATE INDEX "idx_relay_log_created_at" ON "relay-log"("created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_relay_log_status" ON "relay-log"("relay_status");

-- CreateIndex
CREATE INDEX "idx_relay_log_sensor_reading" ON "relay-log"("sensor_reading_id");

-- CreateIndex
CREATE INDEX "idx_relay_log_command" ON "relay-log"("command_id");

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_assignments" ADD CONSTRAINT "device_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_assignments" ADD CONSTRAINT "device_assignments_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("device_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_commands" ADD CONSTRAINT "device_commands_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("device_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_commands" ADD CONSTRAINT "device_commands_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("device_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_acknowledged_by_user_id_fkey" FOREIGN KEY ("acknowledged_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "irrigation_rules" ADD CONSTRAINT "irrigation_rules_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("device_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relay-log" ADD CONSTRAINT "fk_sensor_reading" FOREIGN KEY ("sensor_reading_id") REFERENCES "sensor-data"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "relay-log" ADD CONSTRAINT "relay-log_command_id_fkey" FOREIGN KEY ("command_id") REFERENCES "device_commands"("id") ON DELETE SET NULL ON UPDATE CASCADE;
