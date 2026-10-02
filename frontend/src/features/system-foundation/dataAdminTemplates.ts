export const CLEAR_ALL_ORDERS_SQL = `WITH target_orders AS (
  SELECT order_id FROM operation_orders
), deleted_action_states AS (
  DELETE FROM order_action_states AS states
  USING target_orders AS target
  WHERE states.order_id = target.order_id
  RETURNING states.order_id
), deleted_events AS (
  DELETE FROM order_events AS events
  USING target_orders AS target
  WHERE events.order_id = target.order_id
  RETURNING events.order_id
), deleted_orders AS (
  DELETE FROM operation_orders AS orders
  USING target_orders AS target
  WHERE orders.order_id = target.order_id
  RETURNING orders.order_id
)
SELECT
  (SELECT count(*) FROM deleted_action_states) AS deleted_action_states,
  (SELECT count(*) FROM deleted_events) AS deleted_events,
  (SELECT count(*) FROM deleted_orders) AS deleted_orders`
