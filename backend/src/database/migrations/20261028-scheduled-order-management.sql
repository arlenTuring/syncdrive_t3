CREATE TABLE IF NOT EXISTS scheduled_order_entries (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  request_key varchar(100) NOT NULL,
  request_hash varchar(64) NOT NULL,
  display_name varchar(120) NOT NULL,
  vehicle_code varchar(64) NOT NULL REFERENCES vehicles(vehicle_code),
  route_id varchar NOT NULL REFERENCES operation_routes(route_id),
  map_id varchar NULL,
  planned_start bigint NOT NULL,
  planned_end bigint NULL,
  route_snapshot jsonb NOT NULL,
  state varchar(16) NOT NULL DEFAULT 'PENDING'
    CHECK (state IN ('PENDING', 'PUBLISHED', 'CANCELLED', 'EXPIRED', 'FAILED')),
  operation_order_id varchar NULL UNIQUE REFERENCES operation_orders(order_id),
  created_by varchar(64) NOT NULL,
  created_at bigint NOT NULL,
  cancelled_at bigint NULL,
  published_at bigint NULL,
  last_attempt_at bigint NULL,
  last_error text NULL,
  CONSTRAINT scheduled_order_time_order CHECK (planned_end IS NULL OR planned_end >= planned_start)
);

CREATE UNIQUE INDEX IF NOT EXISTS UQ_SCHEDULED_ORDER_REQUEST_KEY
  ON scheduled_order_entries(request_key);
CREATE INDEX IF NOT EXISTS IDX_SCHEDULED_ORDER_DUE
  ON scheduled_order_entries(state, planned_start);
CREATE INDEX IF NOT EXISTS IDX_SCHEDULED_ORDER_VEHICLE_TIME
  ON scheduled_order_entries(vehicle_code, planned_start);
CREATE UNIQUE INDEX IF NOT EXISTS UQ_SCHEDULED_ORDER_ACTIVE_VEHICLE_TIME
  ON scheduled_order_entries(vehicle_code, planned_start)
  WHERE state IN ('PENDING', 'PUBLISHED');
