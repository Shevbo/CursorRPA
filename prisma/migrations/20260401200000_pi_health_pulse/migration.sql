-- CreateTable
CREATE TABLE "pi_health_pulses" (
    "device_key" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL,
    "payload_json" JSONB NOT NULL,

    CONSTRAINT "pi_health_pulses_pkey" PRIMARY KEY ("device_key")
);
